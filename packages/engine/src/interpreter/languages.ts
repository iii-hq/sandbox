export interface LanguageConfig {
  kernelName: string
  fileExtension: string
  installCommand: (packages: string[]) => string[]
}

export const LANGUAGES: Record<string, LanguageConfig> = {
  python: {
    kernelName: "python3",
    fileExtension: ".py",
    installCommand: (pkgs) => ["pip", "install", ...pkgs],
  },
  javascript: {
    kernelName: "javascript",
    fileExtension: ".js",
    installCommand: (pkgs) => ["npm", "install", "-g", ...pkgs],
  },
  typescript: {
    kernelName: "typescript",
    fileExtension: ".ts",
    installCommand: (pkgs) => ["npm", "install", "-g", ...pkgs],
  },
  go: {
    kernelName: "go",
    fileExtension: ".go",
    installCommand: (pkgs) => ["go", "install", ...pkgs],
  },
  bash: {
    kernelName: "bash",
    fileExtension: ".sh",
    installCommand: (pkgs) => ["apt-get", "install", "-y", ...pkgs],
  },
}

export function getLanguageConfig(language: string): LanguageConfig {
  const config = LANGUAGES[language.toLowerCase()]
  if (!config) throw new Error(`Unsupported language: ${language}`)
  return config
}
