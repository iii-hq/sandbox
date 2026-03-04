import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES } from "../state/schema.js";
import { getDocker } from "../docker/client.js";
import type { Sandbox } from "../types.js";

export interface PortMapping {
  containerPort: number;
  hostPort: number;
  protocol: string;
  state: "mapped" | "active";
}

export function registerPortFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "port::expose", description: "Expose a port from a sandbox" },
    async (input: {
      id: string;
      containerPort: number;
      hostPort?: number;
      protocol?: string;
    }): Promise<PortMapping> => {
      const ctx = getContext();
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);
      if (sandbox.status !== "running")
        throw new Error(`Sandbox is not running: ${sandbox.status}`);

      if (
        !Number.isInteger(input.containerPort) ||
        input.containerPort < 1 ||
        input.containerPort > 65535
      )
        throw new Error(`Invalid container port: ${input.containerPort}`);

      const protocol = input.protocol ?? "tcp";
      if (protocol !== "tcp" && protocol !== "udp")
        throw new Error(`Invalid protocol: ${protocol}`);

      let existing: PortMapping[] = [];
      if (sandbox.metadata.ports) {
        try {
          existing = JSON.parse(sandbox.metadata.ports);
        } catch {
          existing = [];
        }
      }

      const duplicate = existing.find(
        (p) =>
          p.containerPort === input.containerPort && p.protocol === protocol,
      );
      if (duplicate)
        throw new Error(
          `Port ${input.containerPort}/${protocol} already exposed`,
        );

      let hostPort = input.hostPort ?? input.containerPort;
      if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535)
        throw new Error(`Invalid host port: ${hostPort}`);

      let state: "mapped" | "active" = "mapped";
      try {
        const container = getDocker().getContainer(`iii-sbx-${input.id}`);
        const info = await container.inspect();
        const dockerPorts = info.NetworkSettings?.Ports ?? {};
        const key = `${input.containerPort}/${protocol}`;
        if (dockerPorts[key]?.length) {
          hostPort = parseInt(dockerPorts[key][0].HostPort, 10) || hostPort;
          state = "active";
        }
      } catch {
        ctx.logger.warn("Could not inspect container ports", {
          id: input.id,
        });
      }

      const mapping: PortMapping = {
        containerPort: input.containerPort,
        hostPort,
        protocol,
        state,
      };

      existing.push(mapping);
      sandbox.metadata.ports = JSON.stringify(existing);
      await kv.set(SCOPES.SANDBOXES, input.id, sandbox);

      ctx.logger.info("Port exposed", {
        id: input.id,
        containerPort: input.containerPort,
        hostPort,
      });

      return mapping;
    },
  );

  sdk.registerFunction(
    { id: "port::list", description: "List exposed ports for a sandbox" },
    async (input: { id: string }): Promise<{ ports: PortMapping[] }> => {
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);

      let stored: PortMapping[] = [];
      if (sandbox.metadata.ports) {
        try {
          stored = JSON.parse(sandbox.metadata.ports);
        } catch {
          stored = [];
        }
      }

      try {
        const container = getDocker().getContainer(`iii-sbx-${input.id}`);
        const info = await container.inspect();
        const dockerPorts = info.NetworkSettings?.Ports ?? {};

        for (const mapping of stored) {
          const key = `${mapping.containerPort}/${mapping.protocol}`;
          if (dockerPorts[key]?.length) {
            mapping.hostPort =
              parseInt(dockerPorts[key][0].HostPort, 10) || mapping.hostPort;
            mapping.state = "active";
          } else {
            mapping.state = "mapped";
          }
        }
      } catch {
        // container may not be accessible
      }

      return { ports: stored };
    },
  );

  sdk.registerFunction(
    {
      id: "port::unexpose",
      description: "Remove a port mapping from a sandbox",
    },
    async (input: {
      id: string;
      containerPort: number;
    }): Promise<{ removed: number }> => {
      const ctx = getContext();
      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.id);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.id}`);

      let existing: PortMapping[] = [];
      if (sandbox.metadata.ports) {
        try {
          existing = JSON.parse(sandbox.metadata.ports);
        } catch {
          existing = [];
        }
      }

      const filtered = existing.filter(
        (p) => p.containerPort !== input.containerPort,
      );

      if (filtered.length === existing.length)
        throw new Error(`Port ${input.containerPort} is not exposed`);

      sandbox.metadata.ports = JSON.stringify(filtered);
      await kv.set(SCOPES.SANDBOXES, input.id, sandbox);

      ctx.logger.info("Port unexposed", {
        id: input.id,
        containerPort: input.containerPort,
      });

      return { removed: input.containerPort };
    },
  );
}
