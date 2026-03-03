import { z } from "zod"

export const tools = [
  {
    name: "sandbox_create",
    description: "Create a new Docker sandbox for code execution",
    inputSchema: z.object({
      image: z.string().default("python:3.12-slim").describe("Docker image to use"),
      name: z.string().optional().describe("Optional sandbox name"),
      timeout: z.number().optional().describe("TTL in seconds (default 3600)"),
      memory: z.number().optional().describe("Memory limit in MB (default 512)"),
      network: z.boolean().optional().describe("Enable networking (default false)"),
    }),
  },
  {
    name: "sandbox_exec",
    description: "Run a shell command in a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      command: z.string().describe("Shell command to execute"),
      timeout: z.number().optional().describe("Timeout in seconds"),
    }),
  },
  {
    name: "sandbox_run_code",
    description: "Execute code in a sandbox (Python, JavaScript, Go, Bash)",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      code: z.string().describe("Code to execute"),
      language: z.enum(["python", "javascript", "typescript", "go", "bash"]).default("python"),
    }),
  },
  {
    name: "sandbox_read_file",
    description: "Read file contents from a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      path: z.string().describe("File path inside the sandbox"),
    }),
  },
  {
    name: "sandbox_write_file",
    description: "Write content to a file in a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      path: z.string().describe("File path inside the sandbox"),
      content: z.string().describe("File content"),
    }),
  },
  {
    name: "sandbox_list_files",
    description: "List files in a sandbox directory",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      path: z.string().default("/workspace").describe("Directory path"),
    }),
  },
  {
    name: "sandbox_install_package",
    description: "Install a package in a sandbox (pip, npm, or go)",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      packages: z.array(z.string()).describe("Package names to install"),
      manager: z.enum(["pip", "npm", "go"]).default("pip"),
    }),
  },
  {
    name: "sandbox_list",
    description: "List all active sandboxes",
    inputSchema: z.object({}),
  },
  {
    name: "sandbox_kill",
    description: "Kill and remove a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
    }),
  },
  {
    name: "sandbox_metrics",
    description: "Get resource usage metrics for a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
    }),
  },
] as const
