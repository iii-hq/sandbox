import { z } from "zod";

export const tools = [
  {
    name: "sandbox_create",
    description: "Create a new Docker sandbox for code execution",
    inputSchema: z.object({
      image: z
        .string()
        .default("python:3.12-slim")
        .describe("Docker image to use"),
      name: z.string().optional().describe("Optional sandbox name"),
      timeout: z.number().optional().describe("TTL in seconds (default 3600)"),
      memory: z
        .number()
        .optional()
        .describe("Memory limit in MB (default 512)"),
      network: z
        .boolean()
        .optional()
        .describe("Enable networking (default false)"),
      template: z
        .string()
        .optional()
        .describe("Template name or ID to create sandbox from"),
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
      language: z
        .enum(["python", "javascript", "typescript", "go", "bash"])
        .default("python"),
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
  {
    name: "sandbox_env_get",
    description: "Get an environment variable from a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      key: z.string().describe("Environment variable name"),
    }),
  },
  {
    name: "sandbox_env_set",
    description: "Set environment variables in a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      vars: z.record(z.string()).describe("Key-value pairs to set"),
    }),
  },
  {
    name: "sandbox_env_list",
    description: "List all environment variables in a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
    }),
  },
  {
    name: "sandbox_git_clone",
    description: "Clone a git repository into a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      url: z.string().describe("Repository URL to clone"),
      path: z.string().optional().describe("Target path inside sandbox"),
      branch: z.string().optional().describe("Branch to clone"),
      depth: z.number().optional().describe("Shallow clone depth"),
    }),
  },
  {
    name: "sandbox_git_status",
    description: "Get git status in a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      path: z.string().optional().describe("Repository path"),
    }),
  },
  {
    name: "sandbox_git_commit",
    description: "Create a git commit in a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      message: z.string().describe("Commit message"),
      path: z.string().optional().describe("Repository path"),
      all: z.boolean().optional().describe("Stage all changes before commit"),
    }),
  },
  {
    name: "sandbox_git_diff",
    description: "Show git diff in a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      path: z.string().optional().describe("Repository path"),
      staged: z.boolean().optional().describe("Show staged changes"),
    }),
  },
  {
    name: "sandbox_process_list",
    description: "List running processes in a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
    }),
  },
  {
    name: "sandbox_process_kill",
    description: "Kill a process running in a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      pid: z.number().describe("Process ID to kill"),
      signal: z
        .enum(["TERM", "KILL", "INT", "HUP", "USR1", "USR2", "STOP", "CONT"])
        .optional()
        .describe("Signal to send (default TERM)"),
    }),
  },
  {
    name: "sandbox_template_list",
    description: "List all available sandbox templates",
    inputSchema: z.object({}),
  },
  {
    name: "sandbox_snapshot_create",
    description: "Create a snapshot of a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      name: z.string().optional().describe("Optional snapshot name"),
    }),
  },
  {
    name: "sandbox_snapshot_restore",
    description: "Restore a sandbox from a snapshot",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      snapshotId: z.string().describe("Snapshot ID to restore from"),
    }),
  },
  {
    name: "sandbox_snapshot_list",
    description: "List all snapshots for a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
    }),
  },
  {
    name: "sandbox_clone",
    description: "Clone a sandbox with all its state",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID to clone"),
      name: z
        .string()
        .optional()
        .describe("Optional name for the cloned sandbox"),
    }),
  },
  {
    name: "sandbox_port_expose",
    description: "Expose a port from a sandbox container",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      containerPort: z.number().describe("Port inside the container to expose"),
      hostPort: z.number().optional().describe("Port on the host to map to"),
      protocol: z
        .enum(["tcp", "udp"])
        .optional()
        .describe("Protocol (default tcp)"),
    }),
  },
  {
    name: "sandbox_port_list",
    description: "List all exposed ports for a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
    }),
  },
  {
    name: "sandbox_events_history",
    description: "Query sandbox event history with optional filters",
    inputSchema: z.object({
      sandboxId: z.string().optional().describe("Filter by sandbox ID"),
      topic: z.string().optional().describe("Filter by event topic"),
      limit: z.number().optional().describe("Max events to return"),
    }),
  },
  {
    name: "sandbox_events_publish",
    description: "Publish a custom sandbox event",
    inputSchema: z.object({
      topic: z.string().describe("Event topic"),
      sandboxId: z.string().describe("Sandbox ID"),
      data: z.record(z.unknown()).optional().describe("Event payload data"),
    }),
  },
  {
    name: "sandbox_exec_queue",
    description: "Submit a command to the execution queue with retries and DLQ",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      command: z.string().describe("Shell command to queue"),
      maxRetries: z
        .number()
        .optional()
        .describe("Max retry attempts (default 3)"),
      timeout: z.number().optional().describe("Command timeout in seconds"),
    }),
  },
  {
    name: "sandbox_queue_status",
    description: "Get the status of a queued job",
    inputSchema: z.object({
      jobId: z.string().describe("Queue job ID"),
    }),
  },
  {
    name: "sandbox_network_create",
    description: "Create a Docker network for sandbox-to-sandbox communication",
    inputSchema: z.object({
      name: z.string().describe("Network name"),
      driver: z
        .string()
        .optional()
        .describe("Docker network driver (default bridge)"),
    }),
  },
  {
    name: "sandbox_network_connect",
    description: "Connect a sandbox to a network",
    inputSchema: z.object({
      networkId: z.string().describe("Network ID"),
      sandboxId: z.string().describe("Sandbox ID to connect"),
    }),
  },
  {
    name: "sandbox_stream_logs",
    description:
      "Get recent log output from a sandbox container (returns last N lines)",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      tail: z
        .number()
        .optional()
        .describe("Number of recent lines to return (default 100)"),
    }),
  },
  {
    name: "sandbox_traces",
    description: "List function execution traces with optional filters",
    inputSchema: z.object({
      sandboxId: z.string().optional().describe("Filter by sandbox ID"),
      functionId: z.string().optional().describe("Filter by function ID"),
      limit: z.number().optional().describe("Max traces to return"),
    }),
  },
  {
    name: "sandbox_metrics_dashboard",
    description:
      "Get aggregated observability metrics including request counts, latency, and error rates",
    inputSchema: z.object({}),
  },
  {
    name: "sandbox_set_alert",
    description:
      "Set a resource alert on a sandbox (triggers action when metric exceeds threshold)",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      metric: z
        .enum(["cpu", "memory", "pids"])
        .describe("Resource metric to monitor"),
      threshold: z
        .number()
        .describe("Threshold value (0-100 for cpu/memory, 1-256 for pids)"),
      action: z
        .enum(["notify", "pause", "kill"])
        .optional()
        .describe("Action when threshold exceeded (default notify)"),
    }),
  },
  {
    name: "sandbox_alert_history",
    description: "Get alert event history for a sandbox",
    inputSchema: z.object({
      sandboxId: z.string().describe("Sandbox ID"),
      limit: z
        .number()
        .optional()
        .describe("Max events to return (default 50)"),
    }),
  },
  {
    name: "sandbox_volume_create",
    description:
      "Create a persistent Docker volume for data that survives sandbox restarts",
    inputSchema: z.object({
      name: z.string().describe("Volume name"),
      driver: z
        .string()
        .optional()
        .describe("Docker volume driver (default local)"),
    }),
  },
  {
    name: "sandbox_volume_attach",
    description: "Attach a persistent volume to a sandbox at a mount path",
    inputSchema: z.object({
      volumeId: z.string().describe("Volume ID"),
      sandboxId: z.string().describe("Sandbox ID"),
      mountPath: z.string().describe("Mount path inside the sandbox"),
    }),
  },
] as const;
