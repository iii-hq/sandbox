import { getContext } from "iii-sdk";
import type { StateKV } from "../state/kv.js";
import type { EngineConfig } from "../config.js";
import { SCOPES, generateId } from "../state/schema.js";
import { getDocker } from "../docker/client.js";
import type { Sandbox, SandboxNetwork } from "../types.js";

export function registerNetworkFunctions(
  sdk: any,
  kv: StateKV,
  config: EngineConfig,
) {
  sdk.registerFunction(
    { id: "network::create", description: "Create a Docker network" },
    async (input: {
      name: string;
      driver?: string;
    }): Promise<SandboxNetwork> => {
      const ctx = getContext();
      if (!input.name) throw new Error("Network requires name");

      const existing = await kv.list<SandboxNetwork>(SCOPES.NETWORKS);
      if (existing.some((n) => n.name === input.name))
        throw new Error(`Network ${input.name} already exists`);

      const networkId = generateId("net");
      const driver = input.driver ?? "bridge";
      const dockerNetwork = await getDocker().createNetwork({
        Name: `iii-net-${networkId}`,
        Driver: driver,
      });

      const info = await dockerNetwork.inspect();

      const network: SandboxNetwork = {
        id: networkId,
        name: input.name,
        dockerNetworkId: info.Id,
        sandboxes: [],
        createdAt: Date.now(),
      };

      await kv.set(SCOPES.NETWORKS, networkId, network);

      ctx.logger.info("Network created", { id: networkId, name: input.name });

      return network;
    },
  );

  sdk.registerFunction(
    { id: "network::list", description: "List all networks" },
    async (): Promise<{ networks: SandboxNetwork[] }> => {
      const networks = await kv.list<SandboxNetwork>(SCOPES.NETWORKS);
      return { networks };
    },
  );

  sdk.registerFunction(
    { id: "network::connect", description: "Connect a sandbox to a network" },
    async (input: {
      networkId: string;
      sandboxId: string;
    }): Promise<{ connected: true }> => {
      const ctx = getContext();
      const network = await kv.get<SandboxNetwork>(
        SCOPES.NETWORKS,
        input.networkId,
      );
      if (!network) throw new Error(`Network not found: ${input.networkId}`);

      const sandbox = await kv.get<Sandbox>(SCOPES.SANDBOXES, input.sandboxId);
      if (!sandbox) throw new Error(`Sandbox not found: ${input.sandboxId}`);

      if (network.sandboxes.includes(input.sandboxId))
        throw new Error(
          `Sandbox ${input.sandboxId} already connected to network ${input.networkId}`,
        );

      const dockerNetwork = getDocker().getNetwork(network.dockerNetworkId);
      await dockerNetwork.connect({ Container: `iii-sbx-${input.sandboxId}` });

      network.sandboxes.push(input.sandboxId);
      await kv.set(SCOPES.NETWORKS, input.networkId, network);

      ctx.logger.info("Sandbox connected to network", {
        networkId: input.networkId,
        sandboxId: input.sandboxId,
      });

      return { connected: true };
    },
  );

  sdk.registerFunction(
    {
      id: "network::disconnect",
      description: "Disconnect a sandbox from a network",
    },
    async (input: {
      networkId: string;
      sandboxId: string;
    }): Promise<{ disconnected: true }> => {
      const ctx = getContext();
      const network = await kv.get<SandboxNetwork>(
        SCOPES.NETWORKS,
        input.networkId,
      );
      if (!network) throw new Error(`Network not found: ${input.networkId}`);

      if (!network.sandboxes.includes(input.sandboxId))
        throw new Error(
          `Sandbox ${input.sandboxId} is not connected to network ${input.networkId}`,
        );

      const dockerNetwork = getDocker().getNetwork(network.dockerNetworkId);
      await dockerNetwork.disconnect({
        Container: `iii-sbx-${input.sandboxId}`,
      });

      network.sandboxes = network.sandboxes.filter(
        (id) => id !== input.sandboxId,
      );
      await kv.set(SCOPES.NETWORKS, input.networkId, network);

      ctx.logger.info("Sandbox disconnected from network", {
        networkId: input.networkId,
        sandboxId: input.sandboxId,
      });

      return { disconnected: true };
    },
  );

  sdk.registerFunction(
    { id: "network::delete", description: "Delete a network" },
    async (input: { networkId: string }): Promise<{ deleted: string }> => {
      const ctx = getContext();
      const network = await kv.get<SandboxNetwork>(
        SCOPES.NETWORKS,
        input.networkId,
      );
      if (!network) throw new Error(`Network not found: ${input.networkId}`);

      const dockerNetwork = getDocker().getNetwork(network.dockerNetworkId);

      for (const sandboxId of network.sandboxes) {
        try {
          await dockerNetwork.disconnect({
            Container: `iii-sbx-${sandboxId}`,
          });
        } catch {
          ctx.logger.warn("Failed to disconnect sandbox during network delete", {
            networkId: input.networkId,
            sandboxId,
          });
        }
      }

      await dockerNetwork.remove();
      await kv.delete(SCOPES.NETWORKS, input.networkId);

      ctx.logger.info("Network deleted", { id: input.networkId });

      return { deleted: input.networkId };
    },
  );
}
