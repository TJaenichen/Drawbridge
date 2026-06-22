import {
  type DrawbridgeConfig,
  type ElementType,
  type GeneratedTool,
  type OperationConfig,
  type ParamConfig,
} from "../model.js";
import { generatedOps, toolName } from "./naming.js";

function elementSchema(type: ElementType, members?: string[]): Record<string, unknown> {
  if (type === "enum") return { type: "string", enum: members };
  return { type };
}

/** Map one flattened param to its JSON Schema property. */
function paramSchema(p: ParamConfig): Record<string, unknown> {
  let s: Record<string, unknown>;
  if (p.type === "array") s = { type: "array", items: elementSchema(p.items!.type, p.items!.enum) };
  else if (p.type === "enum") s = { type: "string", enum: p.enum };
  else s = { type: p.type };

  if (p.description !== undefined) s.description = p.description;
  if (p.default !== undefined) s.default = p.default;
  return s;
}

/** Build the flat MCP tool input schema for an operation (the `in:` location is hidden). */
export function buildInputSchema(op: OperationConfig): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of op.params ?? []) {
    properties[p.name] = paramSchema(p);
    if (p.required === true || p.in === "path") required.push(p.name);
  }
  return { type: "object", additionalProperties: false, properties, required };
}

/** Generate all MCP tools from a resolved config. */
export function generateTools(config: DrawbridgeConfig): GeneratedTool[] {
  const tools: GeneratedTool[] = [];
  for (const [key, platform] of Object.entries(config.platforms)) {
    for (const op of generatedOps(platform)) {
      tools.push({
        name: toolName(key, op),
        description: op.description,
        inputSchema: buildInputSchema(op),
        platformKey: key,
        operation: op,
      });
    }
  }
  return tools;
}
