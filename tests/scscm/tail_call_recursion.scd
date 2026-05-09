// Tail-call recursion test for hclang_native (Phase 12.3d).
//
// scscm compiles Scheme to sclang and depends on tail-call elimination
// to handle recursive idioms (named-let, mutual recursion, looping
// constructs) without blowing the WASM stack. This test exercises the
// path with a deeply recursive sclang function — if hclang.wasm was
// compiled with `-mtail-call` and the WAMR runtime has
// WAMR_BUILD_TAIL_CALL=1 (both landed 2026-05-08), the recursion
// should return without trapping.
//
// Usage:
//   ./build/native/hclang_host/hclang_native \
//     --classlib-dir src/class_library \
//     --script tests/scscm/tail_call_recursion.scd
//
// Expected output: a single line `tail-call recursion ok at depth N`
// where N is the depth the loop reached. Any "Exception:" / "SIGSEGV" /
// "stack overflow" output means the recursion blew the WASM stack and
// the tail-call layers aren't doing their job.

(
var loop, depth = 200000;

// Recursive function with the recursive call in tail position. SC's
// bytecode interpreter doesn't itself eliminate tail calls — but the
// underlying clang-compiled libhclang now emits `return_call` in its
// own code paths. This test serves as a regression canary: if the
// recursion stops working at smaller depths than before, something
// in the lower layers regressed.
loop = { |n|
    if (n <= 0) {
        0
    } {
        loop.value(n - 1)
    }
};

("tail-call recursion ok at depth " ++ depth ++ " (returned " ++ loop.value(depth) ++ ")").postln;
)
