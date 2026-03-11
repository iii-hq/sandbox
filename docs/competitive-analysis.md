# iii-sandbox Competitive Analysis: Sandbox/Container/MicroVM Platforms

**Research Date:** 2026-03-11
**Sources:** E2B docs, Modal docs, Fly.io docs, Daytona docs, Blaxel blog, Superagent benchmark (Jan 2026), Ry Walker Research (Feb 2026), Pixeljets comparison, Together AI blog, Runloop pricing page, Cloudflare Workers docs, AWS Lambda docs, Google Cloud Run docs, Alex Ellis blog (SlicerVM), Morph Cloud docs, NumaVM Firecracker benchmark

---

## 1. E2B (e2b.dev)

**What it is:** Market-leading ephemeral sandbox for AI agents. Firecracker microVMs. Used by 88% of Fortune 100. 200M+ sandboxes started, 1M+ monthly SDK downloads.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | ~150ms (from snapshot restore: 150-200ms) | Superagent Benchmark Jan 2026, Blaxel comparison Feb 2026 |
| **Exec latency** | Not separately published | — |
| **API endpoints** | Filesystem, Process, Terminal, Snapshots, Lifecycle Events, Webhooks, Code Interpreter | e2b.dev/docs |
| **SDK languages** | Python, JavaScript/TypeScript, Go | e2b.dev/docs |
| **Pricing** | Hobby: $0/mo + $100 one-time credits; Pro: $150/mo; CPU: $0.000014/vCPU/s ($0.0504/hr); RAM: $0.0000045/GiB/s ($0.0162/hr) | e2b.dev/pricing |
| **Open source?** | Yes (Apache-2.0 for SDK; infra components open source) | github.com/e2b-dev/E2B |
| **Filesystem ops** | Read, write, watch, upload, download files | e2b.dev/docs/filesystem |
| **Terminal/PTY** | Yes | e2b.dev/docs |
| **Snapshot support** | Yes (filesystem + memory state) | e2b.dev/docs/sandbox/snapshots |
| **Git integration** | Yes (full git access inside sandbox) | e2b.dev/docs/agents/opencode |
| **Max concurrent** | Hobby: 20; Pro: 100-1,100; Enterprise: 1,100+ | e2b.dev/docs/billing |
| **Max session** | Hobby: 1hr; Pro: 24hr; Enterprise: custom | e2b.dev/docs/billing |
| **Self-hosted** | Yes (BYOC on AWS; GCP/Azure planned) | e2b.dev/docs |
| **Isolation** | Firecracker microVMs (hardware-level, same as AWS Lambda) | e2b.dev |
| **Compliance** | SOC 2 | e2b.dev |
| **Paused sandbox retention** | 30 days, then deleted | Blaxel comparison Feb 2026 |

---

## 2. Modal (modal.com)

**What it is:** Serverless Python-first cloud compute with GPU support. gVisor isolation. Built for ML/AI workloads.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | "Containers boot in about one second" (infra only); total cold start depends on user initialization code (imports, model loading). Memory Snapshots available to reduce. | modal.com/docs/guide/cold-start |
| **Exec latency** | Not separately published; near-native once warm | — |
| **API endpoints** | Functions, Classes, Volumes, Secrets, Images, Webhooks, Queues, Dicts, Sandboxes | modal.com/docs |
| **SDK languages** | Python (primary), JS/TS (beta), Go (beta) | Superagent Benchmark Jan 2026 |
| **Pricing** | Starter: $30/mo free credits; Team: $100/mo free credits; CPU: $0.0000131/core/s (~$0.0472/core/hr, 1 core = 2 vCPU); Memory: $0.00000222/GiB/s; GPU: T4 $0.59/hr to B200 $6.25/hr | modal.com/pricing |
| **Open source?** | No (proprietary) | — |
| **Filesystem ops** | Modal Volumes (persistent distributed FS), NetworkFileSystem | modal.com/docs |
| **Terminal/PTY** | Yes (via Sandboxes feature) | modal.com/docs |
| **Snapshot support** | Yes (Memory Snapshots for cold start optimization) | modal.com/docs/guide/memory-snapshots |
| **Git integration** | No native; user can install git in image | — |
| **Max concurrent** | Auto-scales; no published hard limit; configurable min/max/buffer containers | modal.com/docs |
| **Max runtime** | 24 hours | Superagent Benchmark Jan 2026 |
| **Self-hosted** | No | — |
| **Isolation** | gVisor (kernel-level) | Ry Walker Research Feb 2026 |
| **Compliance** | SOC 2 | modal.com |
| **GPU support** | Extensive: T4, L4, A10, L40S, A100 40/80GB, RTX PRO 6000, H100, H200, B200 | modal.com/pricing |

---

## 3. Fly.io Machines / Sprites (fly.io / sprites.dev)

**What it is:** Infrastructure-grade Firecracker microVMs in 30+ global regions. Sprites.dev (launched Jan 2026) adds sandbox-specific abstractions.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start (Machines)** | 20-50ms to start a pre-created Machine (same region); double-digit seconds for new Machine from scratch (image pull) | Blaxel comparison Feb 2026 |
| **Cold start (Sprites)** | ~300ms checkpoint/restore; ~100-500ms warm resume at 8GB | Blaxel comparison; GitHub Gist comparison |
| **Exec latency** | 10-15ms when machine is online | Fly.io community forum |
| **API endpoints** | REST API for Machines (create, start, stop, delete, exec, list, wait, metadata); Sprites adds WebSocket command execution | fly.io/docs, sprites.dev |
| **SDK languages** | Sprites: TypeScript, Go, Python, Elixir; Machines: REST API (no official SDK, community wrappers) | Blaxel comparison Feb 2026 |
| **Pricing (Machines)** | Pay-as-you-go per-second; shared-cpu-1x ~$0.0315/hr; performance-1x ~$0.057/hr; Sprites: $0.07/CPU-hr, $0.04375/GB-hr memory | fly.io/docs/about/pricing, Ry Walker Research |
| **Open source?** | No (proprietary platform; Firecracker itself is open source) | — |
| **Filesystem ops** | Fly Volumes (persistent NVMe); Sprites: 100GB persistent ext4 backed by object storage | fly.io/docs |
| **Terminal/PTY** | Yes (ssh, fly ssh console) | fly.io/docs |
| **Snapshot support** | Machines: No memory checkpoint; Sprites: Yes (checkpoint/restore in ~1 second) | Ry Walker Research Feb 2026 |
| **Git integration** | No native; user installs git | — |
| **Max concurrent** | Per-org limits; generally high (thousands) | fly.io/docs |
| **Self-hosted** | No | — |
| **Isolation** | Firecracker microVMs (hardware-level) | fly.io |
| **Compliance** | SOC 2; HIPAA at $99/mo add-on | Blaxel comparison Feb 2026 |
| **Regions** | 30+ global | fly.io |

---

## 4. Daytona (daytona.io)

**What it is:** Fastest creation time (90ms) sandbox platform with Computer Use support. Docker-based isolation. Open source (AGPL-3.0).

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | Sub-90ms from warm pool (claimed). Detailed benchmark: 71ms creation + 67ms execution + 59ms cleanup = 197ms total. Realistic cold starts: 150-200ms. | Pixeljets blog, Daytona docs, Blaxel comparison |
| **Exec latency** | 67ms (execution phase in benchmark) | Pixeljets blog |
| **API endpoints** | Sandbox Create/Delete/Start/Stop, File API (list/read/write/upload/download), Execute, Git API, LSP API, Sessions API, Computer Use API | daytona.io/docs |
| **SDK languages** | Python, TypeScript, Ruby, Go | Blaxel comparison Feb 2026 |
| **Pricing** | $200 free credits; vCPU: $0.0504/hr; Memory: $0.0162/GiB/hr; Storage: $0.000108/GiB/hr (5 GiB free); Startups: up to $50K free | daytona.io/pricing |
| **Open source?** | Yes (AGPL-3.0 — strong copyleft, network clause) | Pixeljets blog |
| **Filesystem ops** | Full API: list, create directories, change permissions, upload, download | daytona.io/docs |
| **Terminal/PTY** | Yes (SSH, VS Code browser, web terminal) | Ry Walker Research |
| **Snapshot support** | No native checkpoint/restore; auto-archive after 7 days inactivity (slow restore from object storage) | Blaxel comparison |
| **Git integration** | Yes (built-in Git API) | Ry Walker Research |
| **Max concurrent** | Not published; scales based on plan | — |
| **Self-hosted** | Yes (requires Kubernetes + Helm) | Pixeljets blog |
| **Isolation** | Docker containers (shared kernel); optional Kata Containers or Sysbox for enhanced isolation | Pixeljets blog, Blaxel comparison |
| **Compliance** | SOC 2 Type II, HIPAA (as of Oct 2025) | Blaxel comparison |
| **Computer Use** | Yes (Linux/Windows/macOS virtual desktops) | Ry Walker Research |

---

## 5. CodeSandbox / Together AI (codesandbox.io / together.ai)

**What it is:** Browser IDE turned AI sandbox. Acquired by Together AI (Dec 2024). Firecracker microVMs with memory snapshotting and live VM cloning.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | ~2.7 seconds at P95 (from scratch); ~511ms at P95 (resume from hibernation) | Together AI public benchmarks via Blaxel comparison |
| **VM clone time** | 1-3 seconds (live VM cloning) | Blaxel comparison |
| **API endpoints** | Sandbox SDK (create, fork, snapshot, exec, filesystem), Code Interpreter | codesandbox.io/docs/sdk, docs.together.ai |
| **SDK languages** | TypeScript/JavaScript only (no Python SDK from CodeSandbox) | Blaxel comparison |
| **Pricing** | Build (free): 5 members, 40hr/mo VM credits; Scale: $170/mo, 160hr/mo, 250 concurrent VMs; Enterprise: custom; vCPU: $0.0446/hr; GiB RAM: pricing on together.ai/pricing | codesandbox.io/pricing, together.ai/pricing |
| **Open source?** | No (proprietary) | — |
| **Filesystem ops** | Full filesystem via SDK | codesandbox.io/docs |
| **Terminal/PTY** | Yes (browser-based terminal) | codesandbox.io |
| **Snapshot support** | Yes (filesystem + memory; live VM cloning with copy-on-write) | Blaxel comparison |
| **Git integration** | Yes (GitHub/GitLab integration) | codesandbox.io |
| **Max concurrent** | Scale plan: 250 VMs; Enterprise: custom | codesandbox.io/pricing |
| **Self-hosted** | No | — |
| **Isolation** | Firecracker microVMs with custom kernel patches | Blaxel comparison |
| **Compliance** | SOC 2 Type II | Blaxel comparison |
| **VM sizes** | 2-64 vCPUs, 1-128 GB RAM, hot-swappable | Blaxel comparison |
| **Weekly VM starts** | 2 million | Blaxel comparison |

---

## 6. Runloop (runloop.ai)

**What it is:** Sandbox platform focused on AI software engineering with built-in SWE-bench benchmarking. MicroVM isolation.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | ~2 seconds (can start 10GB image in under 2s) | Blaxel comparison Feb 2026 |
| **Exec latency** | 100ms command execution (claimed) | Ry Walker Research |
| **API endpoints** | Devboxes (create/start/stop/exec), Blueprints, Snapshots, Repo Connections, Benchmarks, Objects | runloop.ai docs |
| **SDK languages** | Python, TypeScript | runloop.ai docs |
| **Pricing** | Basic: Free + usage + $50 credits; Pro: $250/mo + usage; Enterprise: custom; CPU: $0.108/CPU/hr; Memory: $0.0252/GB/hr; Storage: $0.00034236/GB/hr | runloop.ai/pricing |
| **Open source?** | No (proprietary) | — |
| **Filesystem ops** | Yes (via Devbox exec and SDK) | runloop.ai docs |
| **Terminal/PTY** | Yes | runloop.ai |
| **Snapshot support** | Yes (disk state snapshots, branching) | Ry Walker Research |
| **Git integration** | Yes (repo connections with automatic environment inference) | Ry Walker Research |
| **Max concurrent** | Trial: 3 running Devboxes; Pro/Enterprise: scales to tens of thousands | runloop.ai/pricing, Blaxel comparison |
| **Self-hosted** | Yes (Deploy to VPC on AWS and GCP) | Blaxel comparison |
| **Isolation** | MicroVMs (custom bare-metal hypervisor, 2x faster vCPUs claimed) | Ry Walker Research |
| **Compliance** | SOC 2, HIPAA, GDPR | runloop.ai |
| **Benchmark integration** | Built-in SWE-Bench Verified, custom benchmark suites | Blaxel comparison |

---

## 7. Morph Cloud (morph.so)

**What it is:** Infrastructure for AI agents with instant environment branching ("Infinibranch"). JupyterLab-based sandboxes with memory state snapshots.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | "Milliseconds" from snapshot (claimed; no specific number published) | morph.so/blog |
| **Snapshot branching** | "Instantly" from any snapshot (preserves complete memory state, loaded datasets, kernels) | morph.so/blog/sandbox-morph-cloud |
| **API endpoints** | Sandbox create, execute_command, execute_code, snapshot, branch, file read/write | morph.so docs |
| **SDK languages** | Python (primary) | morph.so/blog |
| **Pricing** | 1 MCU (Morph Compute Unit) = 1 vCPU-hour + 4 GB RAM-hours + 16 GB disk-hours; specific $/MCU requires sign-up | cloud.morph.so/web/subscribe |
| **Open source?** | No (proprietary; examples repo is public) | github.com/morph-labs |
| **Filesystem ops** | Yes (via SDK) | morph.so |
| **Terminal/PTY** | Yes (JupyterLab terminal) | morph.so |
| **Snapshot support** | Yes (full memory + filesystem + running kernels) | morph.so/blog |
| **Git integration** | Not native; user can install | — |
| **Max concurrent** | Not published | — |
| **Self-hosted** | No (cloud-only, early access) | morph.so |
| **Key differentiator** | "Infinibranch" — instant branching of complete environments including in-memory state | morph.so/blog |

---

## 8. SlicerVM (slicervm.com)

**What it is:** Alex Ellis's Firecracker microVM management tool for bare metal. Self-hosted. Designed for slicing bare-metal servers into lightweight VMs.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | ~1-2 seconds including systemd boot; near-instant with ZFS snapshot clones | blog.alexellis.io/slicer-bare-metal-preview |
| **Exec latency** | Near-native (bare metal Firecracker) | — |
| **API endpoints** | REST API (create, delete, list, exec, top), Serial Over SSH (SOS) console | blog.alexellis.io |
| **SDK languages** | None (REST API + CLI) | blog.alexellis.io |
| **Pricing** | $25/mo (GitHub Sponsors "Home Edition"); Commercial: custom pricing | blog.alexellis.io |
| **Open source?** | No (proprietary; requires GitHub sponsorship to activate) | blog.alexellis.io |
| **Filesystem ops** | Full Linux filesystem; ZFS or disk image storage | blog.alexellis.io |
| **Terminal/PTY** | Yes (SSH + Serial Over SSH console) | blog.alexellis.io |
| **Snapshot support** | Yes (via ZFS snapshot clones for instant boot) | blog.alexellis.io |
| **Git integration** | No native; full Linux so user installs git | — |
| **Max concurrent** | Limited by host hardware (tested at massive scale with actuated) | blog.alexellis.io |
| **Self-hosted** | Yes (self-hosted only; requires bare-metal Linux with KVM) | blog.alexellis.io |
| **Isolation** | Firecracker microVMs (hardware-level) | blog.alexellis.io |
| **Key use cases** | Large K8s clusters on single machine, chaos testing, CI/CD runners, GPU passthrough (VFIO) | blog.alexellis.io |
| **OS images** | Ubuntu LTS, Rocky Linux | blog.alexellis.io |

---

## 9. OpenSandbox (Alibaba)

**What it is:** Open-source sandbox platform from Alibaba with protocol-driven architecture. Multi-language SDKs, Docker/Kubernetes runtimes.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | "Seconds" (no specific number published) | Ry Walker Research |
| **Exec latency** | Not published | — |
| **API endpoints** | "Sandbox Protocol" — standardized lifecycle + execution APIs; Command, Filesystem, Code Interpreter | Ry Walker Research |
| **SDK languages** | Python, Java/Kotlin, JS/TS, C#/.NET (Go on roadmap) | Ry Walker Research |
| **Pricing** | Free (open source, self-hosted only) | Ry Walker Research |
| **Open source?** | Yes (Apache-2.0) | github.com/alibaba/OpenSandbox |
| **Filesystem ops** | Built-in Filesystem implementation | Ry Walker Research |
| **Terminal/PTY** | Yes (VNC desktop examples) | Ry Walker Research |
| **Snapshot support** | No (persistent storage on roadmap) | Ry Walker Research |
| **Git integration** | Not native | — |
| **Max concurrent** | Kubernetes-native scaling (theoretically unlimited) | Ry Walker Research |
| **Self-hosted** | Yes (self-hosted only) | Ry Walker Research |
| **Isolation** | Docker/Kubernetes (container-level, weaker than Firecracker) | Ry Walker Research |
| **GitHub stars** | 2K+ | Ry Walker Research |
| **Examples** | Claude Code, Gemini CLI, Codex CLI, OpenClaw, Playwright, Chrome, VNC desktop, VS Code, RL training | Ry Walker Research |

---

## 10. Blaxel (blaxel.ai)

**What it is:** Persistent sandbox platform with sub-25ms resume from perpetual standby. Firecracker microVMs. Co-located agent hosting.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start (resume from standby)** | ~25ms (sub-25ms claimed) | Superagent Benchmark Jan 2026, blaxel.ai |
| **Cold start (from scratch)** | Not published separately | — |
| **Network latency** | Sub-50ms response times | blaxel.ai/blog |
| **API endpoints** | Sandbox create/exec/destroy, Filesystem, Agent hosting, MCP server hosting, Batch jobs, Model gateway, Preview URLs | blaxel.ai docs |
| **SDK languages** | Python, TypeScript, Go | Blaxel comparison Feb 2026 |
| **Pricing** | $200 free credits; usage-based; ~$0.067/hr for 1 vCPU / 1 GiB RAM sandbox | Northflank comparison, blaxel.ai/pricing |
| **Open source?** | No (proprietary) | — |
| **Filesystem ops** | Full filesystem with perpetual state preservation | blaxel.ai |
| **Terminal/PTY** | Yes | blaxel.ai |
| **Snapshot support** | Yes (filesystem + memory, perpetual standby with zero compute cost) | Blaxel comparison |
| **Git integration** | Via agent workflows | — |
| **Max concurrent** | 100,000+ created, 50,000+ concurrently running | Blaxel comparison |
| **Self-hosted** | No | — |
| **Isolation** | Firecracker microVMs (hardware-level) | blaxel.ai |
| **Compliance** | SOC 2 Type II, ISO 27001, HIPAA | Blaxel comparison |
| **Key differentiator** | Perpetual standby (sandboxes persist indefinitely at zero compute cost); agent co-hosting eliminates network roundtrip | blaxel.ai |
| **Auto-shutdown** | ~15 seconds of network inactivity | Blaxel comparison |

---

## 11. Kubernetes Jobs

**What it is:** Native Kubernetes approach using Jobs/Pods for ephemeral compute. Not purpose-built for sandboxing.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | 1-2 seconds (optimal, small images); 10-15 seconds typical (app startup); 3-8 minutes for GPU pods (node provisioning + image pull + CUDA init) | OpenFaaS blog, Reddit r/kubernetes, ScaleOps blog |
| **Exec latency** | Near-native once running | — |
| **API endpoints** | Full Kubernetes API (Jobs, Pods, CronJobs, etc.) | kubernetes.io |
| **SDK languages** | Every language with a Kubernetes client (Python, Go, Java, JS, Ruby, C#, etc.) | kubernetes.io |
| **Pricing** | Free (open source); infrastructure cost varies by provider | — |
| **Open source?** | Yes (Apache-2.0) | kubernetes.io |
| **Filesystem ops** | PersistentVolumeClaims, EmptyDir, ConfigMaps, Secrets | kubernetes.io |
| **Terminal/PTY** | Yes (kubectl exec -it) | kubernetes.io |
| **Snapshot support** | VolumeSnapshots (CSI driver dependent) | kubernetes.io |
| **Git integration** | Via initContainers or git-sync | — |
| **Max concurrent** | Default: 100 pods/node (configurable); cluster-level: thousands | kubernetes.io |
| **Self-hosted** | Yes (self-hosted only, or managed K8s) | — |
| **Isolation** | Container-level (shared kernel); Kata Containers or gVisor for VM-level | kubernetes.io |

---

## 12. AWS Lambda

**What it is:** Serverless functions on Firecracker microVMs. The original Firecracker use case. Massive scale.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | Firecracker VMM: ~100ms to start microVM. Full Lambda cold start: 100-500ms (Node.js/Python), 1-10s (Java/.NET without SnapStart). SnapStart: reduces Java cold starts by up to 92%. | AWS blog, Firecracker project, SoftwareSeni comparison |
| **Exec latency** | Single-digit milliseconds (warm) | AWS docs |
| **API endpoints** | Invoke, CreateFunction, UpdateFunctionCode, Layers, Concurrency, EventSourceMapping, URLs, etc. | AWS Lambda docs |
| **SDK languages** | Native runtimes: Node.js, Python, Java, .NET, Go, Ruby; Custom runtime via Lambda Runtime API | AWS docs |
| **Pricing** | $0.20 per 1M requests; $0.0000166667/GB-second; Free tier: 1M requests + 400,000 GB-seconds/month | aws.amazon.com/lambda/pricing |
| **Open source?** | No (Firecracker VMM is open source under Apache-2.0; Lambda service is proprietary) | — |
| **Filesystem ops** | /tmp (512MB default, up to 10GB); EFS mounting available | AWS docs |
| **Terminal/PTY** | No (event-driven, no interactive terminal) | — |
| **Snapshot support** | Yes (SnapStart for Java/.NET — Firecracker microVM snapshots) | AWS blog |
| **Git integration** | No native | — |
| **Max concurrent** | Default: 1,000 concurrent; requestable up to 10,000+; burst: 500-3,000 depending on region | AWS docs |
| **Max runtime** | 15 minutes | AWS docs |
| **Self-hosted** | No | — |
| **Isolation** | Firecracker microVMs (hardware-level; the gold standard) | AWS |

---

## 13. Google Cloud Run

**What it is:** Serverless containers on Google's infrastructure. gVisor isolation. Auto-scales to zero.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | Container startup latency: ~10ms (99th percentile for the container runtime itself); total cold start: 500ms-11s+ depending on application and image size | Reddit r/googlecloud, StackOverflow, Google Cloud blog |
| **Exec latency** | Sub-200ms achievable for warm instances | StackOverflow |
| **API endpoints** | Services, Jobs, Revisions, Executions, Domains, Traffic | Google Cloud docs |
| **SDK languages** | Any language via container (no runtime restrictions) | Google Cloud docs |
| **Pricing** | vCPU: $0.000024/vCPU-second; Memory: $0.0000025/GiB-second; Requests: $0.40/million; Free tier: 180,000 vCPU-seconds + 360,000 GiB-seconds + 2M requests/month | Google Cloud pricing, Cloudchipr |
| **Open source?** | No (proprietary; based on Knative which is open source) | — |
| **Filesystem ops** | In-memory filesystem; Cloud Storage, Volume mounts (GCS FUSE, NFS) | Google Cloud docs |
| **Terminal/PTY** | No (HTTP request-driven) | — |
| **Snapshot support** | No | — |
| **Git integration** | Via Cloud Build (CI/CD) | Google Cloud docs |
| **Max concurrent** | Up to 1,000 instances per service; configurable concurrency per instance (up to 1,000) | Google Cloud docs |
| **Max runtime** | Services: 60 minutes; Jobs: 24 hours | Google Cloud docs |
| **Self-hosted** | Partially (Cloud Run for Anthos on GKE) | — |
| **Isolation** | gVisor (kernel-level sandbox) | Google Cloud |
| **Startup CPU boost** | Yes (allocates additional CPU during startup to reduce cold start) | Google Cloud docs |

---

## 14. Cloudflare Workers / Containers

**What it is:** Edge compute using V8 isolates (Workers) and Docker containers (Containers beta). 300+ locations globally.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start (Workers)** | ~0ms claimed ("no cold starts" — V8 isolate reuse). Measured: ~1-5ms. | cloudflare.com, Softwareseni comparison |
| **Cold start (Containers beta)** | 2-3 seconds | Superagent Benchmark Jan 2026 |
| **Exec latency** | 10-30ms P50 globally (Workers) | DigitalApplied blog |
| **API endpoints** | Workers: Deploy, KV, R2, D1, Durable Objects, Queues, Workers AI; Containers: create, sleep, wake | Cloudflare docs |
| **SDK languages** | Workers: JavaScript/TypeScript (primary), Rust, C, C++ (via Wasm), Python (beta); Containers: any via Docker | Cloudflare docs |
| **Pricing** | Workers Free: 100K requests/day, $0/mo; Paid: $5/mo base + $0.30/million requests + $0.02/million ms CPU time; Containers: Active CPU pricing (beta) | developers.cloudflare.com/workers/platform/pricing |
| **Open source?** | No (proprietary; workerd runtime is open source) | — |
| **Filesystem ops** | Workers: No (stateless); Containers: Full filesystem (lost on sleep), mount R2/S3 for persistence | Cloudflare docs |
| **Terminal/PTY** | No (Workers); Limited (Containers) | — |
| **Snapshot support** | No | — |
| **Git integration** | Via Wrangler CLI + CI/CD | — |
| **Max concurrent** | Workers: Virtually unlimited; Containers: beta limits | Cloudflare docs |
| **Max runtime** | Workers: 30s (free), 15min (paid), configurable (Cron/Queues); Containers: configurable | Cloudflare docs |
| **Self-hosted** | No | — |
| **Isolation** | Workers: V8 isolates; Containers: Docker (shared kernel) | Cloudflare |
| **Locations** | 300+ PoPs globally | cloudflare.com |
| **Sleep timeout** | Containers: 10 minutes default; all state lost on sleep | Blaxel comparison |

---

## 15. Vercel Sandbox

**What it is:** Firecracker microVMs launched as part of Vercel AI Cloud. Generally available as of mid-2025. Amazon Linux 2023 base.

| Metric | Value | Source |
|--------|-------|--------|
| **Cold start** | "Fast" (no specific number published); filesystem snapshotting preserves deps between runs | Superagent Benchmark Jan 2026 |
| **Exec latency** | Not separately published | — |
| **API endpoints** | Sandbox create/exec/filesystem, integrated with AI SDK | Vercel docs |
| **SDK languages** | TypeScript, Python | Blaxel comparison |
| **Pricing** | Usage-based: $0.128/CPU-hour, $0.0106/GB-hr; Hobby: 45min max; Pro: 5hr max | Superagent Benchmark Jan 2026, vercel.com/pricing |
| **Open source?** | No (proprietary) | — |
| **Filesystem ops** | Yes (filesystem snapshotting) | Vercel docs |
| **Terminal/PTY** | Yes | Vercel docs |
| **Snapshot support** | Yes (filesystem snapshots) | Superagent Benchmark |
| **Git integration** | Deep Vercel/GitHub integration | vercel.com |
| **Max concurrent** | Not published | — |
| **Max runtime** | Hobby: 45min; Pro/Enterprise: 5 hours | Superagent Benchmark |
| **Self-hosted** | No | — |
| **Isolation** | Firecracker microVMs | Blaxel comparison |
| **Active CPU billing** | Yes (charges only when code executes, not during idle) | Blaxel comparison |
| **Templates** | Claude Code, OpenAI Codex CLI templates available | Blaxel comparison |

---

## Normalized Comparison Table

### Cold Start Times (Published/Measured)

| Platform | Cold Start | Resume/Warm Start | Source Quality |
|----------|-----------|-------------------|----------------|
| **Cloudflare Workers** | ~0ms (V8 isolate) | N/A | Published by Cloudflare |
| **Blaxel** | N/A (from scratch) | ~25ms (from standby) | Published by Blaxel |
| **Fly.io Machines** | 20-50ms (pre-created) | — | Community reports |
| **Daytona** | 71ms creation (warm pool) | 150-200ms realistic | Independent benchmark (Pixeljets) |
| **AWS Lambda** | 100-500ms (Node/Python) | Single-digit ms (warm) | AWS official |
| **E2B** | ~150ms | ~150-200ms (snapshot) | Multiple independent sources |
| **Morph Cloud** | "Milliseconds" (from snapshot) | — | Vendor claim, unverified |
| **Fly.io Sprites** | 1-2s (new) | ~300ms (checkpoint) | Vendor published |
| **Modal** | ~1 second (infra only) | Near-instant (warm) | Published by Modal |
| **SlicerVM** | ~1-2s (with systemd) | Near-instant (ZFS clone) | Alex Ellis blog |
| **Kubernetes Jobs** | 1-2s (optimal) | — | Independent benchmarks |
| **Runloop** | ~2 seconds | — | Vendor published |
| **CodeSandbox/Together** | ~2.7s at P95 (cold) | ~511ms at P95 (hibernate) | Together AI public benchmarks |
| **Cloudflare Containers** | 2-3 seconds | — | Independent benchmark |
| **Google Cloud Run** | 500ms-11s (varies) | Sub-200ms (warm) | Community measurements |

### Pricing Comparison (1 vCPU + 2GB RAM, per hour)

| Platform | Hourly Cost | Free Tier |
|----------|------------|-----------|
| **AWS Lambda** | ~$0.06/hr (GB-second model) | 1M requests + 400K GB-s/mo |
| **E2B** | $0.0828/hr | $100 one-time |
| **Daytona** | $0.0828/hr | $200 |
| **Blaxel** | $0.0828/hr | $200 |
| **Cloudflare Workers** | $0.09/hr + $5/mo base | 100K req/day |
| **Modal** | $0.1193/hr | $30/mo |
| **Fly.io Machines** | ~$0.06-0.12/hr | $5/mo org credit |
| **Runloop** | $0.1584/hr | $50 |
| **Vercel Sandbox** | $0.1492/hr | Hobby plan |
| **Google Cloud Run** | ~$0.09/hr | 180K vCPU-s/mo |
| **CodeSandbox/Together** | $0.0446/vCPU-hr + RAM | 40hr/mo (free plan) |
| **Kubernetes Jobs** | Infrastructure dependent | Free (self-hosted) |
| **SlicerVM** | $25/mo flat (home edition) | — |
| **OpenSandbox** | Free (self-hosted) | Free |
| **Morph Cloud** | MCU-based (requires sign-up) | — |

### Feature Matrix

| Platform | Open Source | Self-Host | Snapshots | Terminal | Git | GPU | Isolation Level |
|----------|-----------|-----------|-----------|----------|-----|-----|-----------------|
| E2B | Yes (Apache-2.0) | BYOC (AWS) | Yes (mem+fs) | Yes | Yes | No | Firecracker (HW) |
| Modal | No | No | Memory Snapshots | Yes | No | Yes (extensive) | gVisor (kernel) |
| Fly.io/Sprites | No | No | Sprites: Yes | Yes | No | No | Firecracker (HW) |
| Daytona | Yes (AGPL-3.0) | Yes (K8s) | No | Yes | Yes | Yes | Docker (container) |
| CodeSandbox | No | No | Yes (live clone) | Yes | Yes | No | Firecracker (HW) |
| Runloop | No | VPC deploy | Yes (disk) | Yes | Yes | No | MicroVM (HW) |
| Morph Cloud | No | No | Yes (full mem) | Yes | No | No | Not published |
| SlicerVM | No | Yes (only) | Yes (ZFS) | Yes | No | Yes (VFIO) | Firecracker (HW) |
| OpenSandbox | Yes (Apache-2.0) | Yes (only) | No | Yes | No | No | Docker/K8s (container) |
| Blaxel | No | No | Yes (perpetual) | Yes | No | No | Firecracker (HW) |
| K8s Jobs | Yes (Apache-2.0) | Yes | Volume Snapshots | Yes | Via init | Yes | Container (or Kata) |
| AWS Lambda | No* | No | SnapStart | No | No | No | Firecracker (HW) |
| Cloud Run | No | Partial | No | No | Via Build | Yes (L4) | gVisor (kernel) |
| CF Workers | No* | No | No | No | Via CLI | No | V8 isolate |
| Vercel Sandbox | No | No | Yes (fs) | Yes | Yes | No | Firecracker (HW) |

*Firecracker VMM and workerd runtime are open source; the services are proprietary.

---

## Key Firecracker Benchmark (Raw VMM Performance)

From NumaVM's independent benchmark (March 2026) and AWS/Firecracker project data:

- **Firecracker VMM boot (bare):** ~38ms (Firecracker doing its job)
- **Full cold boot (host setup + Firecracker + Linux):** 1.1 seconds (263ms host setup + 38ms Firecracker + 560ms Linux boot)
- **Firecracker snapshot restore:** ~125ms
- **AWS published Firecracker startup:** ~100ms for microVM, capable of starting thousands per second per host
- **Community measured (Xeon E5-2620, 2 CPUs, 256M):** ~290ms guest boot time

Source: NumaVM blog (numavm.com/blog/2026-03-10-1-second-boot), Firecracker GitHub issue #792, SoftwareSeni comparison, AWS Firecracker project page.

---

## Summary of Findings

1. **Fastest resume from standby:** Blaxel (~25ms) - but this is resume from pre-warmed standby, not cold boot
2. **Fastest cold boot (sandbox-specific):** Daytona (71ms creation from warm pool), E2B (~150ms from snapshot)
3. **Fastest cold boot (general):** Cloudflare Workers (~0ms V8 isolates, but limited to JS/Wasm)
4. **Most comprehensive feature set:** E2B and Daytona lead for AI agent sandboxes
5. **Best for GPUs:** Modal (extensive GPU lineup from T4 to B200)
6. **Best open source:** OpenSandbox (Apache-2.0, self-hosted K8s), E2B (Apache-2.0 SDK), Daytona (AGPL-3.0)
7. **Cheapest:** OpenSandbox (free), Kubernetes Jobs (free), AWS Lambda (generous free tier)
8. **Most SDK languages:** OpenSandbox (Python, Java/Kotlin, JS/TS, C#/.NET) and Daytona (Python, TS, Ruby, Go)
9. **Strongest isolation:** Firecracker-based platforms (E2B, Blaxel, AWS Lambda, Fly.io, CodeSandbox/Together, Vercel, SlicerVM)
10. **Best for self-hosting:** SlicerVM (bare metal), OpenSandbox (K8s), Daytona (K8s+Helm), K8s Jobs
