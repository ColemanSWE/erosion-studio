import { Project, SyntaxKind, ObjectLiteralExpression, Node } from "ts-morph";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const project = new Project();
    
    // Load files
    const procFile = project.addSourceFileAtPath("src/lib/effects/processors.ts");
    const stdProcFile = project.addSourceFileAtPath("src/lib/effects/standard-processors.ts");
    const paramsFile = project.addSourceFileAtPath("src/components/EffectsPanel/EffectParams.tsx");
    const oldTypesFile = project.addSourceFileAtPath("/tmp/types_original.ts");
    
    // 1. Extract default parameters from /tmp/types_original.ts
    const defaultParamsMap = new Map<string, string>();
    const getDefaultsFunc = oldTypesFile.getFunction("getDefaultParams");
    if (getDefaultsFunc) {
        const switchStmt = getDefaultsFunc.getDescendantsOfKind(SyntaxKind.SwitchStatement)[0];
        if (switchStmt) {
            for (const clause of switchStmt.getCaseBlock().getClauses()) {
                if (Node.isCaseClause(clause)) {
                    const expr = clause.getExpression();
                    if (Node.isStringLiteral(expr)) {
                        const effectType = expr.getLiteralValue();
                        const returnStmt = clause.getStatements().find(Node.isReturnStatement);
                        if (returnStmt) {
                            const obj = returnStmt.getExpression();
                            if (obj) {
                                defaultParamsMap.set(effectType, obj.getText());
                            }
                        }
                    }
                }
            }
        }
    }
    
    // 2. Extract param configs from EffectParams.tsx
    const paramsConfigMap = new Map<string, string>();
    const commonParamsVar = paramsFile.getVariableDeclaration("commonParams");
    if (commonParamsVar) {
        const init = commonParamsVar.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
        if (init) {
            for (const prop of init.getProperties()) {
                if (Node.isPropertyAssignment(prop)) {
                    let key = prop.getName();
                    if (key.startsWith('"') || key.startsWith("'")) {
                        key = key.substring(1, key.length - 1);
                    }
                    const val = prop.getInitializer();
                    if (val) {
                        paramsConfigMap.set(key, val.getText());
                    }
                }
            }
        }
    }
    
    const processorModules = new Map<string, string[]>();
    
    const extractEffects = (sourceFile: any) => {
        const callExprs = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
        const effectCalls = [];
        
        for (const call of callExprs) {
            const expr = call.getExpression();
            if (Node.isIdentifier(expr) && expr.getText() === "registerEffect") {
                effectCalls.push(call);
            }
        }
        
        // Process in reverse to safely remove from AST
        for (let i = effectCalls.length - 1; i >= 0; i--) {
            const call = effectCalls[i];
            const args = call.getArguments();
            if (args.length === 1 && Node.isObjectLiteralExpression(args[0])) {
                const obj = args[0] as ObjectLiteralExpression;
                
                const typeProp = obj.getProperty("type");
                const catProp = obj.getProperty("category");
                
                if (Node.isPropertyAssignment(typeProp) && Node.isPropertyAssignment(catProp)) {
                    const typeInit = typeProp.getInitializer();
                    const catInit = catProp.getInitializer();
                    
                    if (typeInit && Node.isStringLiteral(typeInit) && catInit && Node.isStringLiteral(catInit)) {
                        const effectType = typeInit.getLiteralValue();
                        const category = catInit.getLiteralValue();
                        
                        const defaultParams = defaultParamsMap.get(effectType) || "{}";
                        const paramsConfig = paramsConfigMap.get(effectType) || "[]";
                        
                        // Let's manually inject the properties
                        // We use index to insert them safely
                        let objText = obj.getText();
                        const procMatch = objText.match(/processor\s*[\(:\|]/);
                        if (procMatch && procMatch.index !== undefined) {
                            const newObjText = objText.substring(0, procMatch.index) + 
                                `  defaultParams: ${defaultParams},\n` +
                                `  paramsConfig: ${paramsConfig},\n  ` +
                                objText.substring(procMatch.index);
                                
                            const fullCallText = `registerEffect(${newObjText});`;
                            
                            if (!processorModules.has(category)) {
                                processorModules.set(category, []);
                            }
                            processorModules.get(category).push(fullCallText);
                        }
                    }
                }
            }
            
            // Remove from AST
            const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
            if (stmt) {
                stmt.remove();
            }
        }
    };
    
    extractEffects(procFile);
    extractEffects(stdProcFile);
    
    // The remaining AST in procFile and stdProcFile represent our shared utilities.
    // Ensure everything top-level is exported.
    const exportedNames = new Set<string>();
    
    const exportStatements = (sourceFile: any) => {
        for (const stmt of sourceFile.getStatements()) {
            if (Node.isVariableStatement(stmt)) {
                if (!stmt.hasExportKeyword()) {
                    stmt.addModifier("export");
                }
                for (const dec of stmt.getDeclarations()) {
                    exportedNames.add(dec.getName());
                }
            } else if (Node.isFunctionDeclaration(stmt) || Node.isClassDeclaration(stmt) || Node.isInterfaceDeclaration(stmt) || Node.isTypeAliasDeclaration(stmt)) {
                if (!stmt.hasExportKeyword()) {
                    stmt.addModifier("export");
                }
                if (stmt.getName()) {
                    exportedNames.add(stmt.getName());
                }
            }
        }
    };
    
    exportStatements(procFile);
    exportStatements(stdProcFile);
    
    // Save the shared state
    const outDir = "src/lib/effects/processors";
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    // Combine standard proc remainder and proc remainder into a shared.ts
    // Strip original imports
    const stripImports = (file: any) => {
        const iDecls = file.getImportDeclarations();
        for (let i = iDecls.length - 1; i >= 0; i--) {
            iDecls[i].remove();
        }
    };
    stripImports(procFile);
    stripImports(stdProcFile);
    
    const sharedContent = `import { EffectType, EffectParamConfig } from "../types";\n` + 
                          `import { ProcessConfig } from "../effect-registry";\n` + 
                          `import { FaceBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";\n\n` +
                          procFile.getText() + "\n" + stdProcFile.getText();
                          
    fs.writeFileSync(path.join(outDir, "shared.ts"), sharedContent);
    
    const exportedList = Array.from(exportedNames).join(", ");
    
    // Write out category files
    const categories = Array.from(processorModules.keys());
    for (const cat of categories) {
        const effects = processorModules.get(cat) || [];
        
        let content = `import { registerEffect, ProcessConfig } from "../effect-registry";\n`;
        content += `import { EffectType, EffectParamConfig } from "../types";\n`;
        content += `import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";\n`;
        
        if (exportedNames.size > 0) {
            content += `import { ${exportedList} } from "./shared";\n\n`;
        } else {
            content += `\n`;
        }
        
        // Effects were processed in reverse, reverse again to preserve original top-to-bottom order
        content += effects.reverse().join("\n\n");
        
        fs.writeFileSync(path.join(outDir, `${cat}.ts`), content);
    }
    
    // Create index.ts
    let indexContent = "";
    for (const cat of categories) {
        indexContent += `import "./${cat}";\n`;
    }
    fs.writeFileSync(path.join(outDir, "index.ts"), indexContent);
    
    console.log("Successfully extracted effects into modules!");
}

main().catch(console.error);
