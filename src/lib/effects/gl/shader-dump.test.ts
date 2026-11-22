import { it } from "vitest";
import { getAllEffects } from "../effect-registry";
import { buildFragmentSrc, VERTEX_SRC } from "./shaders";
import "../processors";

/**
 * Not a real test: when SHADER_DUMP is set, writes every effect's assembled
 * fragment shader to that path so `npm run check:shaders` can compile them in
 * a real WebGL2 context (Node has no GL). Skipped in normal test runs.
 */
const out = process.env.SHADER_DUMP;

it.runIf(!!out)("dumps assembled shader sources", () => {
  const shaders: Record<string, string> = { __vertex: VERTEX_SRC };
  for (const def of getAllEffects()) {
    if (def.glsl) shaders[def.type] = buildFragmentSrc(def.glsl.fragment);
  }
  // node:fs is aliased for the Electron renderer build; use the builtin directly.
  const fs = (process as unknown as { getBuiltinModule(id: string): typeof import("fs") }).getBuiltinModule("fs");
  fs.writeFileSync(out!, JSON.stringify(shaders));
});
