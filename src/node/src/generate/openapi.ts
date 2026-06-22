// OpenAPI -> draft Drawbridge config. Produces a config object a human prunes
// (curation is the allowlist). The mapping rules here are the cross-language contract
// (mirrored in the .NET generator and locked by specs/fixtures/generate).

type AnyObj = Record<string, any>;

const SCALAR = ["string", "integer", "number", "boolean"];
const METHODS = ["get", "post", "put", "patch", "delete"];

function snake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase();
}

function resolveSchema(schema: AnyObj | undefined, root: AnyObj): AnyObj {
  if (schema?.$ref) {
    const parts = String(schema.$ref).replace(/^#\//, "").split("/");
    let node: any = root;
    for (const p of parts) node = node?.[p];
    return node ?? {};
  }
  return schema ?? {};
}

function elementType(schema: AnyObj): string {
  if (schema.enum) return "enum";
  return SCALAR.includes(schema.type) ? schema.type : "string";
}

function mapType(schema: AnyObj): string {
  if (schema.enum) return "enum";
  if (schema.type === "array") return "array";
  return SCALAR.includes(schema.type) ? schema.type : "string";
}

function mapParam(name: string, location: string, schema: AnyObj, required: boolean, root: AnyObj): AnyObj {
  const type = mapType(schema);
  const p: AnyObj = { name, in: location, type };
  if (type === "enum") p.enum = schema.enum;
  if (type === "array") {
    const items = resolveSchema(schema.items, root);
    p.items = { type: elementType(items) };
    if (items.enum) p.items.enum = items.enum;
  }
  if (required) p.required = true;
  if (schema.default !== undefined) p.default = schema.default;
  return p;
}

function authFromSchemes(schemes: AnyObj | undefined): AnyObj {
  if (!schemes || Object.keys(schemes).length === 0) return { type: "bearer", secret_env: "API_TOKEN" };
  const [name, scheme] = Object.entries(schemes)[0] as [string, AnyObj];
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  if (scheme.type === "http" && scheme.scheme === "basic") return { type: "basic", username_env: `${base}_USER`, password_env: `${base}_PASS` };
  if (scheme.type === "apiKey" && scheme.in === "header") return { type: "header", name: scheme.name, secret_env: `${base}_KEY` };
  return { type: "bearer", secret_env: `${base}_TOKEN` };
}

/** Generate a draft Drawbridge config object from an OpenAPI document. */
export function generateConfig(openapi: AnyObj, platformKey: string): AnyObj {
  const baseUrl = openapi.servers?.[0]?.url ?? "${BASE_URL}";
  const auth = authFromSchemes(openapi.components?.securitySchemes);

  const operations: AnyObj[] = [];
  for (const [path, item] of Object.entries((openapi.paths ?? {}) as AnyObj)) {
    for (const method of METHODS) {
      const op = (item as AnyObj)[method];
      if (!op) continue;
      const name = snake(op.operationId ?? `${method}_${path}`);
      const description = op.summary ?? op.description ?? `TODO: describe ${name}`;
      const params: AnyObj[] = [];
      for (const p of (op.parameters ?? []) as AnyObj[]) {
        params.push(mapParam(p.name, p.in, resolveSchema(p.schema, openapi), p.required === true, openapi));
      }
      const bodySchema = resolveSchema(op.requestBody?.content?.["application/json"]?.schema, openapi);
      for (const [propName, propSchema] of Object.entries((bodySchema.properties ?? {}) as AnyObj)) {
        const required = Array.isArray(bodySchema.required) && bodySchema.required.includes(propName);
        params.push(mapParam(propName, "body", resolveSchema(propSchema as AnyObj, openapi), required, openapi));
      }
      const operation: AnyObj = { name, description, method: method.toUpperCase(), path };
      if (params.length) operation.params = params;
      operations.push(operation);
    }
  }

  return { version: 1, platforms: { [platformKey]: { base_url: baseUrl, auth, operations } } };
}
