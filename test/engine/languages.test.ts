import { describe, it, expect } from "vitest"
import { getLanguageConfig, LANGUAGES } from "../../packages/engine/src/interpreter/languages.js"

describe("LANGUAGES", () => {
  it("has 5 language configs", () => {
    expect(Object.keys(LANGUAGES)).toHaveLength(5)
  })

  it("contains python, javascript, typescript, go, bash", () => {
    expect(Object.keys(LANGUAGES).sort()).toEqual(["bash", "go", "javascript", "python", "typescript"])
  })

  it("all languages have required fields", () => {
    for (const [, config] of Object.entries(LANGUAGES)) {
      expect(config.kernelName).toBeTruthy()
      expect(config.fileExtension).toMatch(/^\./)
      expect(config.installCommand).toBeTypeOf("function")
    }
  })

  it("all file extensions start with dot", () => {
    for (const [, config] of Object.entries(LANGUAGES)) {
      expect(config.fileExtension.charAt(0)).toBe(".")
    }
  })

  it("all kernel names are non-empty strings", () => {
    for (const [, config] of Object.entries(LANGUAGES)) {
      expect(config.kernelName.length).toBeGreaterThan(0)
    }
  })
})

describe("getLanguageConfig", () => {
  it("returns python config", () => {
    const cfg = getLanguageConfig("python")
    expect(cfg.kernelName).toBe("python3")
    expect(cfg.fileExtension).toBe(".py")
  })

  it("returns javascript config", () => {
    const cfg = getLanguageConfig("javascript")
    expect(cfg.kernelName).toBe("javascript")
    expect(cfg.fileExtension).toBe(".js")
  })

  it("returns typescript config", () => {
    const cfg = getLanguageConfig("typescript")
    expect(cfg.kernelName).toBe("typescript")
    expect(cfg.fileExtension).toBe(".ts")
  })

  it("returns go config", () => {
    const cfg = getLanguageConfig("go")
    expect(cfg.kernelName).toBe("go")
    expect(cfg.fileExtension).toBe(".go")
  })

  it("returns bash config", () => {
    const cfg = getLanguageConfig("bash")
    expect(cfg.kernelName).toBe("bash")
    expect(cfg.fileExtension).toBe(".sh")
  })

  it("is case insensitive (accepts Python)", () => {
    const cfg = getLanguageConfig("Python")
    expect(cfg.kernelName).toBe("python3")
  })

  it("is case insensitive (accepts JAVASCRIPT)", () => {
    const cfg = getLanguageConfig("JAVASCRIPT")
    expect(cfg.kernelName).toBe("javascript")
  })

  it("throws for unknown language", () => {
    expect(() => getLanguageConfig("rust")).toThrow("Unsupported language: rust")
  })

  it("throws for empty string", () => {
    expect(() => getLanguageConfig("")).toThrow("Unsupported language")
  })

  it("python install uses pip", () => {
    const cfg = getLanguageConfig("python")
    expect(cfg.installCommand(["numpy", "pandas"])).toEqual(["pip", "install", "numpy", "pandas"])
  })

  it("python install with single package", () => {
    const cfg = getLanguageConfig("python")
    expect(cfg.installCommand(["requests"])).toEqual(["pip", "install", "requests"])
  })

  it("javascript install uses npm", () => {
    const cfg = getLanguageConfig("javascript")
    expect(cfg.installCommand(["lodash"])).toEqual(["npm", "install", "-g", "lodash"])
  })

  it("typescript install uses npm", () => {
    const cfg = getLanguageConfig("typescript")
    expect(cfg.installCommand(["tsx"])).toEqual(["npm", "install", "-g", "tsx"])
  })

  it("go install uses go install", () => {
    const cfg = getLanguageConfig("go")
    expect(cfg.installCommand(["github.com/pkg"])).toEqual(["go", "install", "github.com/pkg"])
  })

  it("bash install uses apt-get", () => {
    const cfg = getLanguageConfig("bash")
    expect(cfg.installCommand(["curl"])).toEqual(["apt-get", "install", "-y", "curl"])
  })

  it("install with empty packages array", () => {
    const cfg = getLanguageConfig("python")
    expect(cfg.installCommand([])).toEqual(["pip", "install"])
  })

  it("install with multiple packages spreads them", () => {
    const cfg = getLanguageConfig("bash")
    expect(cfg.installCommand(["curl", "wget", "git"])).toEqual(["apt-get", "install", "-y", "curl", "wget", "git"])
  })
})
