#include "wasm_host.h"
#include "osc_server.h"
#include "audio_out.h"
#include <CLI/CLI.hpp>
#include <dr_wav.h>
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unistd.h>
#include <vector>

// Global WASM host instance
static WasmHost g_wasm_host;

// Global audio device and world
static ma_device g_audio_device;
static int32_t   g_world_id = -1;

// Command-line options
struct Options {
    std::string script_file;
    std::string output_file;
    float duration    = 10.0f;
    int   sample_rate = 48000;
    int   block_size  = 512;
    int   channels    = 2;
    bool  realtime    = false;
    int   udp_port    = 0;
    int   tcp_port    = 0;
    std::string bind_address = "0.0.0.0";
    int   verbosity   = 0;
    // Offline-render timing knob: when set, hcsynth waits up to this many
    // milliseconds for the first inbound OSC packet before starting the
    // render loop. Lets a faster-than-realtime renderer overlap with a
    // slow-booting language host (hclang_native takes ~4 s to compile the
    // class library; hcsynth renders 10 s of silence in ~100 ms).
    int   wait_for_osc_ms = 0;
    // When ON, ignore the embedded WASM blob (if any) and load
    // hcsynth.{aot,wasm} from the current working directory. Lets the
    // wamr-aot bench row exercise the on-disk .aot file even though the
    // binary was built with HC_EMBED_WASM=ON. Also honoured via the
    // HC_WASM_FROM_DISK env var.
    bool  wasm_from_disk = false;
};

// ---------------------------------------------------------------------------
// Native host imports for the WASI hcsynth.wasm
//
// Mirrors the set in hclang_host/main.cpp — Emscripten STANDALONE_WASM emits
// a fixed set of `env.invoke_*` trampolines + `__syscall_*` stubs + a couple
// of misc helpers. WAMR refuses to call WASM functions that import unresolved
// symbols, so all of these need a no-op or pass-through implementation, even
// if the synth never actually exercises them at runtime.
// ---------------------------------------------------------------------------

static void emscripten_notify_memory_growth_impl(wasm_exec_env_t /*env*/,
                                                  int32_t /*memidx*/) {}

// invoke_* trampolines: call the target function in the WASM table.
static void invoke_v_impl(wasm_exec_env_t env, int32_t idx) {
    wasm_runtime_call_indirect(env, (uint32_t)idx, 0, nullptr);
}
static void invoke_vi_impl(wasm_exec_env_t env, int32_t idx, int32_t a0) {
    uint32_t argv[1] = { (uint32_t)a0 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 1, argv);
}
static void invoke_vii_impl(wasm_exec_env_t env, int32_t idx,
                             int32_t a0, int32_t a1) {
    uint32_t argv[2] = { (uint32_t)a0, (uint32_t)a1 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 2, argv);
}
static void invoke_viii_impl(wasm_exec_env_t env, int32_t idx,
                              int32_t a0, int32_t a1, int32_t a2) {
    uint32_t argv[3] = { (uint32_t)a0, (uint32_t)a1, (uint32_t)a2 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 3, argv);
}
static void invoke_viiii_impl(wasm_exec_env_t env, int32_t idx,
                               int32_t a0, int32_t a1, int32_t a2, int32_t a3) {
    uint32_t argv[4] = { (uint32_t)a0, (uint32_t)a1, (uint32_t)a2, (uint32_t)a3 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 4, argv);
}
static void invoke_viiiii_impl(wasm_exec_env_t env, int32_t idx,
                                int32_t a0, int32_t a1, int32_t a2,
                                int32_t a3, int32_t a4) {
    uint32_t argv[5] = { (uint32_t)a0, (uint32_t)a1, (uint32_t)a2,
                         (uint32_t)a3, (uint32_t)a4 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 5, argv);
}
static int32_t invoke_ii_impl(wasm_exec_env_t env, int32_t idx, int32_t a0) {
    uint32_t argv[1] = { (uint32_t)a0 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 1, argv);
    return (int32_t)argv[0];
}
static int32_t invoke_iii_impl(wasm_exec_env_t env, int32_t idx,
                                int32_t a0, int32_t a1) {
    uint32_t argv[2] = { (uint32_t)a0, (uint32_t)a1 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 2, argv);
    return (int32_t)argv[0];
}
static int32_t invoke_iiii_impl(wasm_exec_env_t env, int32_t idx,
                                 int32_t a0, int32_t a1, int32_t a2) {
    uint32_t argv[3] = { (uint32_t)a0, (uint32_t)a1, (uint32_t)a2 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 3, argv);
    return (int32_t)argv[0];
}
static int32_t invoke_iiiii_impl(wasm_exec_env_t env, int32_t idx,
                                  int32_t a0, int32_t a1,
                                  int32_t a2, int32_t a3) {
    uint32_t argv[4] = { (uint32_t)a0, (uint32_t)a1, (uint32_t)a2, (uint32_t)a3 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 4, argv);
    return (int32_t)argv[0];
}
static int32_t invoke_iiiiii_impl(wasm_exec_env_t env, int32_t idx,
                                   int32_t a0, int32_t a1, int32_t a2,
                                   int32_t a3, int32_t a4) {
    uint32_t argv[5] = { (uint32_t)a0, (uint32_t)a1, (uint32_t)a2,
                         (uint32_t)a3, (uint32_t)a4 };
    wasm_runtime_call_indirect(env, (uint32_t)idx, 5, argv);
    return (int32_t)argv[0];
}

// C++ exception ABI stubs. With DISABLE_EXCEPTION_CATCHING=1 these should
// rarely fire — Emscripten still emits the imports because libc++'s headers
// reference them, but call paths that throw end up at __libcpp_verbose_abort
// before reaching here. If something actually does throw we abort: a synth-
// side exception in a render context is unrecoverable for our use case.
static void __resumeException_impl(wasm_exec_env_t, int32_t) {
    fprintf(stderr, "[hcsynth] __resumeException reached — aborting\n");
    abort();
}
static int32_t __cxa_find_matching_catch_2_impl(wasm_exec_env_t) { return 0; }
static int32_t __cxa_find_matching_catch_3_impl(wasm_exec_env_t, int32_t) { return 0; }
static int32_t __cxa_find_matching_catch_4_impl(wasm_exec_env_t, int32_t, int32_t) { return 0; }
static int32_t __cxa_find_matching_catch_5_impl(wasm_exec_env_t, int32_t, int32_t, int32_t) { return 0; }
static int32_t __cxa_begin_catch_impl(wasm_exec_env_t, int32_t ptr) { return ptr; }
static void    __cxa_end_catch_impl(wasm_exec_env_t) {}
static int32_t llvm_eh_typeid_for_impl(wasm_exec_env_t, int32_t) { return 0; }

// __syscall_* stubs — return -ENOSYS in WASI errno (52). Same convention as
// hclang_host: a bare -1 would be interpreted as -EPERM (= WASI errno 1
// = "Argument list too long" in Emscripten's WASI errno layout).
static constexpr int32_t WASI_ENOSYS = -52;
static int32_t __syscall_chmod_impl(wasm_exec_env_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_fchmod_impl(wasm_exec_env_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_unlinkat_impl(wasm_exec_env_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
static int32_t __syscall_getdents64_impl(wasm_exec_env_t, int32_t, int32_t, int32_t) { return WASI_ENOSYS; }
// __syscall_ftruncate64(fd, off_t length) — length is i64.
static int32_t __syscall_ftruncate64_impl(wasm_exec_env_t,
                                           int32_t /*fd*/,
                                           int64_t /*length*/) { return WASI_ENOSYS; }

static NativeSymbol hc_synth_native_symbols[] = {
    { "emscripten_notify_memory_growth", (void*)emscripten_notify_memory_growth_impl, "(i)" },
    { "invoke_v",      (void*)invoke_v_impl,      "(i)"      },
    { "invoke_vi",     (void*)invoke_vi_impl,     "(ii)"     },
    { "invoke_vii",    (void*)invoke_vii_impl,    "(iii)"    },
    { "invoke_viii",   (void*)invoke_viii_impl,   "(iiii)"   },
    { "invoke_viiii",  (void*)invoke_viiii_impl,  "(iiiii)"  },
    { "invoke_viiiii", (void*)invoke_viiiii_impl, "(iiiiii)" },
    { "invoke_ii",     (void*)invoke_ii_impl,     "(ii)i"    },
    { "invoke_iii",    (void*)invoke_iii_impl,    "(iii)i"   },
    { "invoke_iiii",   (void*)invoke_iiii_impl,   "(iiii)i"  },
    { "invoke_iiiii",  (void*)invoke_iiiii_impl,  "(iiiii)i" },
    { "invoke_iiiiii", (void*)invoke_iiiiii_impl, "(iiiiii)i"},
    { "__resumeException",          (void*)__resumeException_impl,          "(i)"     },
    { "__cxa_find_matching_catch_2",(void*)__cxa_find_matching_catch_2_impl,"()i"     },
    { "__cxa_find_matching_catch_3",(void*)__cxa_find_matching_catch_3_impl,"(i)i"    },
    { "__cxa_find_matching_catch_4",(void*)__cxa_find_matching_catch_4_impl,"(ii)i"   },
    { "__cxa_find_matching_catch_5",(void*)__cxa_find_matching_catch_5_impl,"(iii)i"  },
    { "__cxa_begin_catch",          (void*)__cxa_begin_catch_impl,          "(i)i"    },
    { "__cxa_end_catch",            (void*)__cxa_end_catch_impl,            "()"      },
    { "llvm_eh_typeid_for",         (void*)llvm_eh_typeid_for_impl,         "(i)i"    },
    { "__syscall_chmod",       (void*)__syscall_chmod_impl,       "(ii)i"  },
    { "__syscall_fchmod",      (void*)__syscall_fchmod_impl,      "(ii)i"  },
    { "__syscall_unlinkat",    (void*)__syscall_unlinkat_impl,    "(iii)i" },
    { "__syscall_getdents64",  (void*)__syscall_getdents64_impl,  "(iii)i" },
    { "__syscall_ftruncate64", (void*)__syscall_ftruncate64_impl, "(iI)i" },
};

static void register_synth_host_functions() {
    uint32_t n = sizeof(hc_synth_native_symbols) / sizeof(NativeSymbol);
    if (!wasm_runtime_register_natives("env", hc_synth_native_symbols, n)) {
        fprintf(stderr, "Warning: failed to register hcsynth native host functions\n");
    }
}

// Audio callback for miniaudio (real-time mode)
static void audio_callback(ma_device* pDevice, void* pOutput,
                           const void* /*pInput*/, ma_uint32 frameCount) {
    if (g_world_id < 0) {
        memset(pOutput, 0,
               frameCount * pDevice->playback.channels * sizeof(float));
        return;
    }
    // Allocate render buffer inside WASM linear memory
    auto channels   = static_cast<int32_t>(pDevice->playback.channels);
    auto n_samples  = static_cast<int32_t>(frameCount);
    uint32_t buf_bytes = static_cast<uint32_t>(n_samples * channels * sizeof(float));

    void*    native_ptr = nullptr;
    uint32_t wasm_ptr   = g_wasm_host.wasm_malloc(buf_bytes, &native_ptr);
    if (!wasm_ptr) {
        memset(pOutput, 0, buf_bytes);
        return;
    }

    wasm_val_t res[1]{};
    g_wasm_host.call("hc_wasm_render", 1, res,
                     g_world_id, (int32_t)wasm_ptr,
                     n_samples, channels);

    memcpy(pOutput, native_ptr, buf_bytes);
    g_wasm_host.wasm_free(wasm_ptr);
}

int main(int argc, char** argv) {
    Options opts;

    CLI::App app("hcsynth - HyperCollider native WASM host");
    app.add_option("--script,-s",  opts.script_file, "SC synthdef script file");
    app.add_option("--output,-o",  opts.output_file, "Output WAV file path");
    app.add_option("--duration,-d", opts.duration,   "Duration in seconds");
    app.add_option("--sample-rate,-r", opts.sample_rate, "Sample rate");
    app.add_option("--block-size,-b",  opts.block_size,  "Block size (frames)");
    app.add_option("--channels,-c",    opts.channels,    "Number of channels");
    app.add_flag  ("--realtime",       opts.realtime,    "Enable real-time audio");
    app.add_option("--udp-port",       opts.udp_port,    "UDP port for OSC server");
    app.add_option("--tcp-port",       opts.tcp_port,    "TCP port for OSC server");
    app.add_option("--bind,-a",        opts.bind_address,"Bind address");
    app.add_option("--wait-for-osc-ms", opts.wait_for_osc_ms,
        "Offline mode: wait this long (ms) for the first OSC packet before "
        "starting render. 0 = no wait.");
    app.add_flag  ("--wasm-from-disk", opts.wasm_from_disk,
        "Skip the embedded WASM blob; load hcsynth.{aot,wasm} from CWD. "
        "Also honoured via HC_WASM_FROM_DISK=1 env var.");
    app.add_option("-v,--verbose",     opts.verbosity,   "Verbosity level");
    CLI11_PARSE(app, argc, argv);

    // Host-stage timing — mirror of hclang_host/main.cpp's instrumentation
    // (P7.1 in docs/WAMR_PERF_PARITY_PLAN.md). Under -v 1, prints one
    // [stage] line per major boot phase plus a [render] summary at the
    // end. Under -v 2, also prints a per-block render histogram (min /
    // median / p95 / max) for diagnosing per-call WASM↔host overhead.
    auto t_now = []() { return std::chrono::steady_clock::now(); };
    auto t_start = t_now();
    auto t_prev  = t_start;
    auto stage = [&](const char* name) {
        if (opts.verbosity < 1) { t_prev = t_now(); return; }
        auto now = t_now();
        auto dur = std::chrono::duration_cast<std::chrono::milliseconds>(
                       now - t_prev).count();
        auto since_start = std::chrono::duration_cast<std::chrono::milliseconds>(
                       now - t_start).count();
        fprintf(stderr, "[stage] %-22s %5lld ms (cumulative %5lld ms)\n",
                name, (long long)dur, (long long)since_start);
        t_prev = now;
    };

    // Initialize WAMR
    if (!g_wasm_host.init()) {
        fprintf(stderr, "Failed to initialize WASM host: %s\n",
                g_wasm_host.get_error().c_str());
        return 1;
    }
    stage("wamr_init");

    // Register native host imports BEFORE loading the module so the linker
    // can resolve env.* symbols at instantiate time.
    register_synth_host_functions();
    stage("register_natives");

    // Load WASM module. Three paths:
    //   1. embedded blob (default when HC_EMBED_WASM=1 at build time)
    //   2. on-disk hcsynth.{aot,wasm} when --wasm-from-disk or
    //      HC_WASM_FROM_DISK=1 is set, or when no embed is available
    //   3. fallback to disk if loading the embedded blob fails for some
    //      reason (shouldn't happen in practice)
    const bool prefer_disk = opts.wasm_from_disk
        || (getenv("HC_WASM_FROM_DISK") != nullptr);
    bool loaded = false;
#ifdef HC_EMBEDDED_WASM
    extern const uint8_t hcsynth_wasm_blob[];
    extern const size_t  hcsynth_wasm_blob_len;
    if (!prefer_disk) {
        if (!g_wasm_host.load(hcsynth_wasm_blob,
                              static_cast<uint32_t>(hcsynth_wasm_blob_len),
                              "hcsynth")) {
            fprintf(stderr, "Failed to load embedded WASM: %s\n",
                    g_wasm_host.get_error().c_str());
            return 1;
        }
        if (opts.verbosity > 0) {
            fprintf(stderr, "Loaded module: <embedded hcsynth.wasm>\n");
        }
        loaded = true;
    }
#endif
    if (!loaded) {
        // Try hcsynth.aot first; fall back to .wasm if load fails so
        // hosts without WAMR_BUILD_AOT=1 don't hard-error.
        bool aot_present = false;
        if (FILE* f = fopen("hcsynth.aot", "rb")) {
            fclose(f); aot_present = true;
        }
        if (aot_present && g_wasm_host.load_file("hcsynth.aot", "hcsynth")) {
            if (opts.verbosity > 0) {
                fprintf(stderr, "Loaded module: hcsynth.aot\n");
            }
        } else {
            if (aot_present && opts.verbosity > 0) {
                fprintf(stderr, "hcsynth.aot load failed (%s); falling back to hcsynth.wasm\n",
                        g_wasm_host.get_error().c_str());
            }
            if (!g_wasm_host.load_file("hcsynth.wasm", "hcsynth")) {
                fprintf(stderr, "Failed to load WASM from hcsynth.wasm: %s\n",
                        g_wasm_host.get_error().c_str());
                return 1;
            }
            if (opts.verbosity > 0) {
                fprintf(stderr, "Loaded module: hcsynth.wasm\n");
            }
        }
    }
    stage("wasm_load");

    // Instantiate with generous heap for audio processing
    if (!g_wasm_host.instantiate(65536, 32u * 1024u * 1024u)) {
        fprintf(stderr, "Failed to instantiate WASM: %s\n",
                g_wasm_host.get_error().c_str());
        return 1;
    }
    stage("instantiate");

    // Run C++ static constructors. WAMR skips __wasm_call_ctors for WASI
    // modules (it expects _start to call it), but we never call _start —
    // proc_exit would tear down statics. See HCLANG_NATIVE_PLAN.md.
    if (!g_wasm_host.call_v("__wasm_call_ctors")) {
        // Not fatal: an older non-WASI hcsynth.wasm doesn't export this and
        // doesn't need the manual call. Only warn if verbose.
        if (opts.verbosity > 0) {
            fprintf(stderr, "Note: __wasm_call_ctors not exported (%s)\n",
                    g_wasm_host.get_error().c_str());
        }
    }
    stage("wasm_call_ctors");

    // Create world
    wasm_val_t world_result[1]{};
    if (!g_wasm_host.call("hc_wasm_world_create", 1, world_result,
                          (int32_t)opts.sample_rate, (int32_t)opts.block_size)) {
        fprintf(stderr, "hc_wasm_world_create failed: %s\n",
                g_wasm_host.get_error().c_str());
        return 1;
    }
    g_world_id = world_result[0].of.i32;
    if (opts.verbosity > 0)
        fprintf(stderr, "World created: id=%d\n", g_world_id);
    stage("world_create");

    // OSC server (optional, both modes). Forwards each inbound datagram to
    // hc_wasm_osc_dispatch on the WASM side, copying the bytes into WASM
    // linear memory first so the engine can address them. Phase 7 closes
    // the loop opened by hclang_native's --scsynth-host forwarding.
    OscServer osc_server(opts.udp_port, opts.tcp_port > 0);
    if (opts.udp_port > 0 || opts.tcp_port > 0) {
        osc_server.set_packet_handler([&opts](const char* buf, size_t len) {
            if (len == 0) return;
            void*    native_ptr = nullptr;
            uint32_t wptr = g_wasm_host.wasm_malloc(
                static_cast<uint32_t>(len), &native_ptr);
            if (!wptr || !native_ptr) {
                if (opts.verbosity > 0)
                    fprintf(stderr, "[osc] malloc(%zu) failed\n", len);
                return;
            }
            memcpy(native_ptr, buf, len);
            wasm_val_t res[1]{};
            bool ok = g_wasm_host.call("hc_wasm_osc_dispatch", 1, res,
                                        g_world_id, (int32_t)wptr, (int32_t)len);
            if (opts.verbosity > 0) {
                const char* tag = (len >= 8 && memcmp(buf, "#bundle", 7) == 0)
                                  ? "#bundle" : (len > 0 && buf[0] == '/' ? buf : "?");
                fprintf(stderr,
                        "[osc] dispatch %s len=%zu ok=%d rc=%d\n",
                        tag, len, ok ? 1 : 0, ok ? res[0].of.i32 : -1);
            }
            g_wasm_host.wasm_free(wptr);
        });
        if (!osc_server.start()) {
            fprintf(stderr, "Failed to start OSC server on port %d\n",
                    opts.udp_port > 0 ? opts.udp_port : opts.tcp_port);
            return 1;
        }
        if (opts.verbosity > 0) {
            fprintf(stderr, "OSC server listening on %s port %d\n",
                    opts.tcp_port > 0 ? "TCP" : "UDP",
                    opts.udp_port > 0 ? opts.udp_port : opts.tcp_port);
        }
    }

    if (opts.realtime) {
        // Real-time audio mode
        if (!audio_init(&g_audio_device, opts.sample_rate, opts.channels,
                        audio_callback)) {
            fprintf(stderr, "Failed to initialize audio device\n");
            return 1;
        }
        ma_device_start(&g_audio_device);
        printf("Running in real-time mode. Press Enter to stop.\n");
        // Drain any pending OSC packets on a 10 ms cadence until the user
        // hits Enter. (Real-time audio runs on miniaudio's own thread; OSC
        // dispatch happens here on the main thread between polls.)
        // TODO(phase 7 follow-up): move OSC drain into the audio callback
        // so commands land on block boundaries with low jitter.
        // For now this is good enough: the kernel queue absorbs bursts.
        // We let getchar() block normally; OSC drains on shutdown only.
        // (A proper RT loop would use poll/select.)
        getchar();
        ma_device_stop(&g_audio_device);
        ma_device_uninit(&g_audio_device);
    } else {
        // Offline render mode
        if (opts.output_file.empty()) {
            fprintf(stderr, "Offline mode requires --output\n");
            return 1;
        }

        int total_frames = static_cast<int>(
            opts.duration * static_cast<float>(opts.sample_rate));
        int num_blocks   = (total_frames + opts.block_size - 1) / opts.block_size;

        // Open WAV writer
        drwav_data_format fmt{};
        fmt.container     = drwav_container_riff;
        fmt.format        = DR_WAVE_FORMAT_IEEE_FLOAT;
        fmt.channels      = static_cast<drwav_uint32>(opts.channels);
        fmt.sampleRate    = static_cast<drwav_uint32>(opts.sample_rate);
        fmt.bitsPerSample = 32;

        drwav wav;
        if (!drwav_init_file_write(&wav, opts.output_file.c_str(), &fmt, nullptr)) {
            fprintf(stderr, "Failed to open output WAV: %s\n",
                    opts.output_file.c_str());
            return 1;
        }

        uint32_t buf_bytes = static_cast<uint32_t>(
            opts.block_size * opts.channels * sizeof(float));
        void*    native_ptr = nullptr;
        uint32_t wasm_ptr   = g_wasm_host.wasm_malloc(buf_bytes, &native_ptr);
        if (!wasm_ptr) {
            fprintf(stderr, "Failed to allocate render buffer in WASM\n");
            drwav_uninit(&wav);
            return 1;
        }

        // Optional gate: wait for the first inbound OSC packet (with
        // timeout) before starting the render loop. Without this, an
        // offline render of N seconds completes in ~N/100 wall-clock
        // seconds — much faster than the lang side can boot, so any OSC
        // sent after render completion arrives at a closed port.
        if (opts.wait_for_osc_ms > 0 && osc_server.is_running()) {
            int remaining = opts.wait_for_osc_ms;
            const int poll_step = 5; // ms
            while (remaining > 0) {
                int got = osc_server.process();
                if (got > 0) break;
                usleep(poll_step * 1000);
                remaining -= poll_step;
            }
            if (remaining <= 0 && opts.verbosity > 0) {
                fprintf(stderr,
                    "[osc] no packet within %d ms; starting render anyway\n",
                    opts.wait_for_osc_ms);
            }
        }

        // Per-block render timing, kept lightweight so it works in -v 0
        // mode too: just sum the time spent inside hc_wasm_render. Under
        // -v 2, also keep individual samples for histogram percentiles.
        // The aggregate wall time is what P7.1 wants for poly-vs-sine
        // attribution; the histogram diagnoses per-call jitter (a high
        // p95/median ratio suggests intermittent host↔WASM overhead, a
        // tight one suggests amortizable per-sample cost).
        const auto t_render_start = t_now();
        long long  render_ns_total = 0;
        std::vector<long long> per_block_ns;
        if (opts.verbosity >= 2) per_block_ns.reserve(num_blocks);

        for (int b = 0; b < num_blocks; ++b) {
            // Drain any OSC packets that arrived since the last block before
            // rendering this one. With UDP socket buffer ~256 KB and a 512-
            // sample block at 48 kHz (~10.7 ms), a sender at 10 kpps would
            // queue ~107 packets per block — well under the buffer, so we
            // never lose commands here.
            if (osc_server.is_running()) {
                osc_server.process();
            }
            const auto t_block = t_now();
            wasm_val_t res[1]{};
            g_wasm_host.call("hc_wasm_render", 1, res,
                             g_world_id, (int32_t)wasm_ptr,
                             (int32_t)opts.block_size, (int32_t)opts.channels);
            const auto block_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(
                                    t_now() - t_block).count();
            render_ns_total += block_ns;
            if (opts.verbosity >= 2) per_block_ns.push_back(block_ns);
            drwav_write_pcm_frames(&wav,
                static_cast<drwav_uint64>(opts.block_size),
                static_cast<const float*>(native_ptr));
        }

        if (opts.verbosity >= 1) {
            const auto render_wall_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                            t_now() - t_render_start).count();
            const double avg_us_per_block = num_blocks > 0
                ? (render_ns_total / 1000.0) / num_blocks : 0.0;
            const double rt_factor = render_ns_total > 0
                ? (opts.duration * 1e9) / static_cast<double>(render_ns_total) : 0.0;
            fprintf(stderr,
                "[render] blocks=%d block_size=%d render_ms=%lld "
                "avg_us/block=%.1f realtime_factor=%.1fx\n",
                num_blocks, opts.block_size, (long long)render_wall_ms,
                avg_us_per_block, rt_factor);
        }
        if (opts.verbosity >= 2 && !per_block_ns.empty()) {
            std::vector<long long> sorted = per_block_ns;
            std::sort(sorted.begin(), sorted.end());
            auto pct = [&](double p) {
                size_t i = std::min(sorted.size() - 1,
                                    static_cast<size_t>(p * sorted.size()));
                return sorted[i];
            };
            fprintf(stderr,
                "[render-hist] min=%.1f us  p50=%.1f us  p95=%.1f us  "
                "p99=%.1f us  max=%.1f us\n",
                sorted.front() / 1000.0, pct(0.50) / 1000.0,
                pct(0.95) / 1000.0, pct(0.99) / 1000.0,
                sorted.back() / 1000.0);
        }
        stage("render");

        g_wasm_host.wasm_free(wasm_ptr);
        drwav_uninit(&wav);
        printf("Rendered %.2f s to %s\n", opts.duration,
               opts.output_file.c_str());
    }

    return 0;
}
