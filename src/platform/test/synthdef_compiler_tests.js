/**
 * SynthDef Compiler Tests
 * Validates binary format generation
 */

function decodeSCgf(binary) {
  let offset = 0;

  function readU8() {
    return binary[offset++];
  }

  function readI16BE() {
    const value = (binary[offset] << 8) | binary[offset + 1];
    offset += 2;
    return (value << 16) >> 16;
  }

  function readI32BE() {
    const value =
      (binary[offset] << 24) |
      (binary[offset + 1] << 16) |
      (binary[offset + 2] << 8) |
      binary[offset + 3];
    offset += 4;
    return value;
  }

  function readF32BE() {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint8(0, binary[offset]);
    view.setUint8(1, binary[offset + 1]);
    view.setUint8(2, binary[offset + 2]);
    view.setUint8(3, binary[offset + 3]);
    offset += 4;
    return view.getFloat32(0, false);
  }

  function readString() {
    const len = readU8();
    const bytes = binary.slice(offset, offset + len);
    offset += len;
    return String.fromCharCode(...bytes);
  }

  const magic = String.fromCharCode(readU8(), readU8(), readU8(), readU8());
  const version = readI32BE();
  const numDefs = readI16BE();

  const defs = [];
  for (let d = 0; d < numDefs; d++) {
    const name = readString();

    const numConstants = readI32BE();
    const constants = [];
    for (let i = 0; i < numConstants; i++) {
      constants.push(readF32BE());
    }

    const numControls = readI32BE();
    const controls = [];
    for (let i = 0; i < numControls; i++) {
      controls.push(readF32BE());
    }

    const numParamSpecs = readI32BE();
    const paramSpecs = [];
    for (let i = 0; i < numParamSpecs; i++) {
      paramSpecs.push({
        name: readString(),
        index: readI32BE(),
      });
    }

    const numUGens = readI32BE();
    const ugens = [];
    for (let i = 0; i < numUGens; i++) {
      const ugenName = readString();
      const rate = readU8();
      const numInputs = readI32BE();
      const numOutputs = readI32BE();
      const specialIndex = readI16BE();

      const inputs = [];
      for (let j = 0; j < numInputs; j++) {
        inputs.push({
          fromUnitIndex: readI32BE(),
          fromOutputIndex: readI32BE(),
        });
      }

      const outputRates = [];
      for (let j = 0; j < numOutputs; j++) {
        outputRates.push(readU8());
      }

      ugens.push({
        name: ugenName,
        rate,
        numInputs,
        numOutputs,
        specialIndex,
        inputs,
        outputRates,
      });
    }

    const numVariants = readI16BE();

    defs.push({
      name,
      constants,
      controls,
      paramSpecs,
      ugens,
      numVariants,
    });
  }

  return {
    magic,
    version,
    numDefs,
    defs,
  };
}

function testSynthDefCompiler() {
  console.log('=== SynthDef Compiler Tests ===\n');

  // Test 1: Simple SinOsc
  console.log('Test 1: Simple SinOsc SynthDef');
  {
    const compiler = new SynthDefCompiler();
    const synthDef = compiler.compileSynthDef('sine', (c) => {
      const osc = c.SinOsc(440, 0, 'ar');
      const mul = c.Mul({ type: 'ugen', ugenIndex: osc, outputIndex: 0 }, 0.1, 'ar');
      c.Out(0, [{ type: 'ugen', ugenIndex: mul, outputIndex: 0 }], 'ar');
    });

    const binary = compiler.toSCgf(synthDef);
    console.log(`  - Constants: [${synthDef.constants.join(', ')}]`);
    console.log(`  - UGens: ${synthDef.ugens.length}`);
    console.log(`  - Binary size: ${binary.length} bytes`);
    console.log(`  - Hex: ${SynthDefCompiler.bytesToHex(binary.slice(0, 32))}...`);
    console.log(`  ✓ PASS\n`);
  }

  // Test 2: SynthDef with control parameter
  console.log('Test 2: SynthDef with control parameter');
  {
    const compiler = new SynthDefCompiler();
    const synthDef = compiler.compileSynthDef('sine_ctl', (c) => {
      const freqCtrl = c.addControl('freq', 440, 'kr');
      const osc = c.SinOsc(
        { type: 'control', index: freqCtrl },
        0,
        'ar'
      );
      const mul = c.Mul({ type: 'ugen', ugenIndex: osc, outputIndex: 0 }, 0.1, 'ar');
      c.Out(0, [{ type: 'ugen', ugenIndex: mul, outputIndex: 0 }], 'ar');
    });

    const binary = compiler.toSCgf(synthDef);
    const numDefs = (binary[8] << 8) | binary[9];

    console.log(`  - Controls: ${synthDef.controls.length}`);
    console.log(`  - Control[0]: ${synthDef.controls[0].name} (default: ${synthDef.controls[0].default})`);
    console.log(`  - First UGen first input type: ${synthDef.ugens[0].inputs[0].type}`);
    console.log(`  - Header numDefs (int16): ${numDefs}`);
    console.log(`  - Binary size: ${compiler.calculateSize(synthDef)} bytes`);

    if (synthDef.ugens[0].inputs[0].type !== 'control') {
      throw new Error('Control input was not preserved as control type');
    }
    if (numDefs !== 1) {
      throw new Error(`Invalid SCgf numDefs header: ${numDefs}`);
    }
    console.log(`  ✓ PASS\n`);
  }

  // Test 3: LFSaw
  console.log('Test 3: LFSaw SynthDef');
  {
    const compiler = new SynthDefCompiler();
    const synthDef = compiler.compileSynthDef('saw', (c) => {
      const saw = c.LFSaw(440, 0, 'ar');
      const mul = c.Mul({ type: 'ugen', ugenIndex: saw, outputIndex: 0 }, 0.1, 'ar');
      c.Out(0, [{ type: 'ugen', ugenIndex: mul, outputIndex: 0 }], 'ar');
    });

    console.log(`  - UGens: ${synthDef.ugens.length}`);
    console.log(`  - UGen[0]: ${synthDef.ugens[0].name}`);
    console.log(`  ✓ PASS\n`);
  }

  // Test 4: Multiple outputs (stereo)
  console.log('Test 4: Stereo output');
  {
    const compiler = new SynthDefCompiler();
    const synthDef = compiler.compileSynthDef('stereo_sine', (c) => {
      const osc1 = c.SinOsc(440, 0, 'ar');
      const osc2 = c.SinOsc(550, 0, 'ar');
      const mul1 = c.Mul({ type: 'ugen', ugenIndex: osc1, outputIndex: 0 }, 0.1, 'ar');
      const mul2 = c.Mul({ type: 'ugen', ugenIndex: osc2, outputIndex: 0 }, 0.1, 'ar');
      c.Out(0, [
        { type: 'ugen', ugenIndex: mul1, outputIndex: 0 },
        { type: 'ugen', ugenIndex: mul2, outputIndex: 0 },
      ], 'ar');
    });

    console.log(`  - Channels: 2`);
    console.log(`  - UGens: ${synthDef.ugens.length}`);
    console.log(`  ✓ PASS\n`);
  }

  // Test 5: SCgf structural round-trip validation
  console.log('Test 5: SCgf structural round-trip');
  {
    const compiler = new SynthDefCompiler();
    const synthDef = compiler.compileSynthDef('roundtrip_ctl', (c) => {
      const freq = c.Control('freq', 330, 'kr');
      const osc = c.SinOsc(freq, 0, 'ar');
      const mul = c.Mul({ type: 'ugen', ugenIndex: osc, outputIndex: 0 }, 0.05, 'ar');
      c.Out(0, [{ type: 'ugen', ugenIndex: mul, outputIndex: 0 }], 'ar');
    });

    const binary = compiler.toSCgf(synthDef);
    const decoded = decodeSCgf(binary);
    const def = decoded.defs[0];

    if (decoded.magic !== 'SCgf') {
      throw new Error(`Bad magic: ${decoded.magic}`);
    }
    if (decoded.version !== 2) {
      throw new Error(`Bad version: ${decoded.version}`);
    }
    if (decoded.numDefs !== 1) {
      throw new Error(`Bad numDefs: ${decoded.numDefs}`);
    }
    if (def.paramSpecs.length !== 1 || def.paramSpecs[0].name !== 'freq') {
      throw new Error('ParamSpec encoding is invalid for control "freq"');
    }
    if (def.ugens.length !== 4) {
      throw new Error(`Expected 4 UGens (Control + 3 user UGens), got ${def.ugens.length}`);
    }

    const controlUGen = def.ugens[0];
    const sinOscUGen = def.ugens[1];
    if (controlUGen.name !== 'Control') {
      throw new Error(`Expected first UGen Control, got ${controlUGen.name}`);
    }
    if (sinOscUGen.inputs[0].fromUnitIndex !== 0 || sinOscUGen.inputs[0].fromOutputIndex !== 0) {
      throw new Error('Control input is not wired through Control UGen output 0');
    }
    if (sinOscUGen.inputs[1].fromUnitIndex !== -1) {
      throw new Error('SinOsc phase input should be constant with fromUnitIndex = -1');
    }

    console.log(`  - Decoded def: ${def.name}`);
    console.log(`  - ParamSpecs: ${def.paramSpecs.length}`);
    console.log(`  - UGen count (with Control): ${def.ugens.length}`);
    console.log(`  ✓ PASS\n`);
  }

  console.log('=== All tests passed! ===\n');
}

// Test the classes
function testSCClasses() {
  console.log('=== SuperCollider Classes Tests ===\n');

  // Test Bus
  console.log('Test 1: Bus');
  {
    const bus = Bus.audio(0, 2);
    console.log(`  - Bus: ${bus.toString()}`);
    console.log(`  ✓ PASS\n`);
  }

  // Test Env
  console.log('Test 2: Env');
  {
    const env = Env.perc(0.01, 1);
    console.log(`  - Env: ${env.toString()}`);
    console.log(`  ✓ PASS\n`);
  }

  // Test SynthDef
  console.log('Test 3: SynthDef');
  {
    const def = SynthDef.new('test', (c) => {
      c.SinOsc(440, 0, 'ar');
    });
    console.log(`  - SynthDef: ${def.toString()}`);
    def.add();
    console.log(`  - Registered: ${SYNTHDEF_REGISTRY.has('test')}`);
    console.log(`  ✓ PASS\n`);
  }

  // Test Synth
  console.log('Test 4: Synth');
  {
    const synth = Synth.new('test', [['freq', 550]], null);
    console.log(`  - Synth: ${synth.toString()}`);
    console.log(`  - Running: ${synth.isRunning}`);
    synth.free();
    console.log(`  - After free: ${synth.isRunning}`);
    console.log(`  ✓ PASS\n`);
  }

  // Test Server
  console.log('Test 5: Server');
  {
    const server = Server.default();
    console.log(`  - Server: ${server.toString()}`);
    console.log(`  - Running: ${server.isRunning}`);
    console.log(`  ✓ PASS\n`);
  }

  console.log('=== All class tests passed! ===\n');
}

// Run all tests
function runAllSynthDefTests() {
  try {
    testSynthDefCompiler();
    testSCClasses();
    console.log('✅ All SynthDef tests completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    decodeSCgf,
    testSynthDefCompiler,
    testSCClasses,
    runAllSynthDefTests,
  };
}
