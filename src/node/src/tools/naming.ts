import type { OperationConfig, PlatformConfig } from "../model.js";

/** Tool name for a generated operation: `{platform}_{operation}`. */
export const toolName = (platformKey: string, op: OperationConfig): string =>
  `${platformKey}_${op.name}`;

/** Operations that become tools for a platform (read_only omits non-GET). */
export function generatedOps(platform: PlatformConfig): OperationConfig[] {
  return platform.read_only ? platform.operations.filter((o) => o.method === "GET") : platform.operations;
}
