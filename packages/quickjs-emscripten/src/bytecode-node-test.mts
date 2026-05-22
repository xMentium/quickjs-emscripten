import assert from "node:assert"
import { test } from "node:test"

import { newQuickJSWASMModule, RELEASE_SYNC } from "./index.js"

function createModuleLoader(sources: Record<string, string>): (moduleName: string) => string {
  return (moduleName) => {
    const source = sources[moduleName]
    if (!source) {
      throw new Error(`Unknown module: ${moduleName}`)
    }
    return source
  }
}

test("trusted bytecode can be exported and imported across fresh contexts", async () => {
  // Arrange
  const QuickJS = await newQuickJSWASMModule(RELEASE_SYNC)

  using compileContext = QuickJS.newContext()
  using compiled = compileContext.unwrapResult(
    compileContext.compileToBytecodeHandle("globalThis.answer = 40 + 2; answer", "eval.js", {
      type: "global",
    }),
  )
  const bytecode = compileContext.dumpBytecode(compiled)

  using runtimeContext = QuickJS.newContext()
  using loaded = runtimeContext.unwrapResult(runtimeContext.loadBytecode(bytecode))

  // Act
  using result = runtimeContext.unwrapResult(runtimeContext.evalFunction(loaded))

  // Assert
  assert.equal(runtimeContext.getNumber(result), 42)
  using answer = runtimeContext.getProp(runtimeContext.global, "answer")
  assert.equal(runtimeContext.getNumber(answer), 42)
})

test("trusted module bytecode can be resolved and evaluated in a fresh runtime", async () => {
  // Arrange
  const QuickJS = await newQuickJSWASMModule(RELEASE_SYNC)

  using compileRuntime = QuickJS.newRuntime({
    moduleLoader: () => "export const value = 9",
  })
  using compileContext = compileRuntime.newContext()
  using compiled = compileContext.unwrapResult(
    compileContext.compileToBytecodeHandle(
      "import { value } from 'dep'; export const answer = value * 7",
      "module.js",
      { type: "module" },
    ),
  )
  const bytecode = compileContext.dumpBytecode(compiled)

  using runtime = QuickJS.newRuntime({
    moduleLoader: () => "export const value = 9",
  })
  using runtimeContext = runtime.newContext()
  using loaded = runtimeContext.unwrapResult(runtimeContext.loadBytecode(bytecode))

  // Act
  runtimeContext.resolveModule(loaded)
  using namespace = runtimeContext.unwrapResult(runtimeContext.evalFunction(loaded))

  // Assert
  using answer = runtimeContext.getProp(namespace, "answer")
  assert.equal(runtimeContext.getNumber(answer), 63)
})

test("trusted module bytecode can resolve transitive imports and produce the expected result", async () => {
  // Arrange
  const QuickJS = await newQuickJSWASMModule(RELEASE_SYNC)
  const sources = {
    dep: "import { base } from 'leaf'; export const value = base * 3",
    leaf: "export const base = 7",
  }

  using compileRuntime = QuickJS.newRuntime({
    moduleLoader: createModuleLoader(sources),
  })
  using compileContext = compileRuntime.newContext()
  using compiled = compileContext.unwrapResult(
    compileContext.compileToBytecodeHandle(
      "import { value } from 'dep'; export const answer = value + 1",
      "entry.js",
      { type: "module" },
    ),
  )
  const bytecode = compileContext.dumpBytecode(compiled)

  using runtime = QuickJS.newRuntime({
    moduleLoader: createModuleLoader(sources),
  })
  using runtimeContext = runtime.newContext()
  using loaded = runtimeContext.unwrapResult(runtimeContext.loadBytecode(bytecode))

  // Act
  runtimeContext.resolveModule(loaded)
  using namespace = runtimeContext.unwrapResult(runtimeContext.evalFunction(loaded))

  // Assert
  using answer = runtimeContext.getProp(namespace, "answer")
  assert.equal(runtimeContext.getNumber(answer), 22)
})

test("trusted module bytecode can resolve sibling imports with a shared dependency", async () => {
  // Arrange
  const QuickJS = await newQuickJSWASMModule(RELEASE_SYNC)
  const moduleLoadCounts = new Map<string, number>()
  const sources = {
    left: "import { shared } from 'shared'; export const left = shared + 1",
    right: "import { shared } from 'shared'; export const right = shared + 2",
    shared: "export const shared = 10",
  }
  const runtimeModuleLoader = (moduleName: string) => {
    moduleLoadCounts.set(moduleName, (moduleLoadCounts.get(moduleName) ?? 0) + 1)
    return createModuleLoader(sources)(moduleName)
  }

  using compileRuntime = QuickJS.newRuntime({
    moduleLoader: createModuleLoader(sources),
  })
  using compileContext = compileRuntime.newContext()
  using compiled = compileContext.unwrapResult(
    compileContext.compileToBytecodeHandle(
      "import { left } from 'left'; import { right } from 'right'; export const answer = left + right",
      "entry.js",
      { type: "module" },
    ),
  )
  const bytecode = compileContext.dumpBytecode(compiled)

  using runtime = QuickJS.newRuntime({
    moduleLoader: runtimeModuleLoader,
  })
  using runtimeContext = runtime.newContext()
  using loaded = runtimeContext.unwrapResult(runtimeContext.loadBytecode(bytecode))

  // Act
  runtimeContext.resolveModule(loaded)
  using namespace = runtimeContext.unwrapResult(runtimeContext.evalFunction(loaded))

  // Assert
  using answer = runtimeContext.getProp(namespace, "answer")
  assert.equal(runtimeContext.getNumber(answer), 23)
  assert.equal(moduleLoadCounts.get("shared"), 1)
})

test("trusted module bytecode with top-level await resolves to the expected exports", async () => {
  // Arrange
  const QuickJS = await newQuickJSWASMModule(RELEASE_SYNC)

  using compileContext = QuickJS.newContext()
  using compiled = compileContext.unwrapResult(
    compileContext.compileToBytecodeHandle(
      "const value = await Promise.resolve(6); export const answer = value * 7",
      "module.js",
      { type: "module" },
    ),
  )
  const bytecode = compileContext.dumpBytecode(compiled)

  using runtime = QuickJS.newRuntime()
  using runtimeContext = runtime.newContext()
  using loaded = runtimeContext.unwrapResult(runtimeContext.loadBytecode(bytecode))

  // Act
  runtimeContext.resolveModule(loaded)
  const promise = runtimeContext.unwrapResult(runtimeContext.evalFunction(loaded))
  runtime.executePendingJobs()
  const promiseState = promise.consume((handle) => runtimeContext.getPromiseState(handle))
  assert.equal(promiseState.type, "fulfilled")
  if (promiseState.type !== "fulfilled") {
    throw new Error(`Expected fulfilled promise, got ${promiseState.type}`)
  }

  // Assert
  using namespace = promiseState.value
  using answer = runtimeContext.getProp(namespace, "answer")
  assert.equal(runtimeContext.getNumber(answer), 42)
})
