import { type Instruction, type WarriorData, type SimulatorOptions, DEFAULT_OPTIONS, Opcode, Modifier, AddressMode, OPCODE_NAMES, MODIFIER_NAMES, ADDRESS_MODE_SYMBOLS } from '../types.js';
import { encodeOpcode, decodeOpcode } from '../constants.js';
import { ExpressionEvaluator } from './expression.js';
import { normalize } from '../utils/modular-arithmetic.js';
import { computePSpaceSize } from '../simulator/pspace.js';

export interface AssemblerMessage {
  type: 'ERROR' | 'WARNING' | 'INFO';
  line: number;
  text: string;
}

export interface AssembleResult {
  success: boolean;
  warrior: WarriorData | null;
  messages: AssemblerMessage[];
}

interface Label {
  name: string;
  value: number;
  isEqu: boolean;
  equText?: string;
  equLines?: string[];
}

export class Assembler {
  private options: Partial<SimulatorOptions>;
  private evaluator: ExpressionEvaluator;

  constructor(options?: Partial<SimulatorOptions>) {
    this.options = options ?? {};
    this.evaluator = new ExpressionEvaluator();
  }

  assemble(source: string): AssembleResult {
    const opts = { ...DEFAULT_OPTIONS, ...this.options };
    const messages: AssemblerMessage[] = [];
    // Handle line continuation: join lines ending with '\' (before any comment)
    const rawLines = source.split('\n');
    const lines: string[] = [];
    let continuation = '';
    for (const rawLine of rawLines) {
      // Strip trailing comment to check for backslash
      const commentPos = rawLine.indexOf(';');
      const beforeComment = commentPos >= 0 ? rawLine.substring(0, commentPos) : rawLine;
      const afterComment = commentPos >= 0 ? rawLine.substring(commentPos) : '';
      if (beforeComment.trimEnd().endsWith('\\')) {
        // Remove the backslash and accumulate
        continuation += beforeComment.trimEnd().slice(0, -1);
      } else {
        lines.push(continuation + rawLine);
        continuation = '';
      }
    }
    if (continuation) lines.push(continuation);

    let name = 'Unknown';
    let author = 'Anonymous';
    let strategy = '';
    let pin: number | null = null;
    let orgOffset = 0;
    let endOffset: number | null = null;

    const labels: Map<string, Label> = new Map();
    const instructions: { line: number; text: string; rawLine: string }[] = [];

    // Set up predefined constants
    this.evaluator.resetRegisters();
    const predefined = new Map<string, number>();
    predefined.set('CORESIZE', opts.coreSize);
    predefined.set('MAXPROCESSES', opts.maxProcesses);
    predefined.set('MAXCYCLES', opts.maxCycles);
    predefined.set('MAXLENGTH', opts.maxLength);
    predefined.set('MINDISTANCE', opts.minSeparation);
    predefined.set('VERSION', 96);
    predefined.set('WARRIORS', opts.warriors);
    predefined.set('ROUNDS', opts.rounds);
    predefined.set('PSPACESIZE', opts.pSpaceSize > 0 ? opts.pSpaceSize : computePSpaceSize(opts.coreSize));
    // READLIMIT/WRITELIMIT: use raw values matching C behavior
    predefined.set('READLIMIT', opts.readLimit);
    predefined.set('WRITELIMIT', opts.writeLimit);

    // Pass 1: collect labels, EQUs, metadata, and instruction lines
    let instrCount = 0;
    const equDefs: Map<string, string> = new Map();
    // Issue #1: multi-line EQU storage
    const multiLineEquDefs: Map<string, string[]> = new Map();
    let forDepth = 0;
    let forBuffer: { label: string | null; count: number; lines: string[] } | null = null;
    const forCounterNames = new Set<string>();

    // Issue #6: ;redcode delimiter tracking
    let redcodeFound = false;
    let redcodeSecond = false;

    // Track the last label seen for multi-line EQU accumulation
    let lastEquLabel: string | null = null;
    let assertFound = false;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      let line = lines[lineNum];
      const rawLine = line;

      // Issue #6: if second ;redcode found, stop processing
      if (redcodeSecond) break;

      // Handle comments at the start of the line (metadata directives)
      const trimmed = line.trim();
      if (trimmed.startsWith(';')) {
        const directive = trimmed.substring(1).trim();
        const upperDir = directive.toUpperCase();

        if (upperDir.startsWith('REDCODE')) {
          // Issue #6: ;redcode delimiter
          if (!redcodeFound) {
            // First ;redcode: clear accumulated state (fresh start)
            redcodeFound = true;
            instructions.length = 0;
            instrCount = 0;
            labels.clear();
            equDefs.clear();
            multiLineEquDefs.clear();
            name = 'Unknown';
            author = 'Anonymous';
            strategy = '';
            pin = null;
            orgOffset = 0;
            endOffset = null;
            lastEquLabel = null;
          } else {
            // Second ;redcode: stop processing
            redcodeSecond = true;
          }
          continue;
        }
        if (upperDir.startsWith('NAME')) {
          name = directive.substring(4).trim() || 'Unknown';
          lastEquLabel = null;
          continue;
        }
        if (upperDir.startsWith('AUTHOR')) {
          author = directive.substring(6).trim() || 'Anonymous';
          lastEquLabel = null;
          continue;
        }
        if (upperDir.startsWith('STRATEGY')) {
          strategy += (strategy ? '\n' : '') + directive.substring(8).trim();
          lastEquLabel = null;
          continue;
        }
        if (upperDir.startsWith('ASSERT')) {
          // Issue #5: ;assert evaluation
          assertFound = true;
          const assertExpr = directive.substring(6).trim();
          if (assertExpr) {
            const substituted = this.substituteEqus(assertExpr, equDefs, predefined);
            const evalResult = this.evaluator.evaluate(substituted);
            if (evalResult.ok && evalResult.value === 0) {
              messages.push({ type: 'ERROR', line: lineNum + 1, text: `Assertion failed: ${assertExpr}` });
            }
          }
          lastEquLabel = null;
          continue;
        }
        // Don't reset lastEquLabel for plain comments - C allows comments
        // between multi-line EQU continuation lines without breaking the chain
        continue;
      }

      // Strip inline comments
      const commentIdx = line.indexOf(';');
      if (commentIdx >= 0) line = line.substring(0, commentIdx);
      line = line.trim();
      if (line.length === 0) continue;

      // FOR/ROF handling
      if (forBuffer) {
        const upperLine = line.toUpperCase().trim();
        if (upperLine.startsWith('ROF')) {
          forDepth--;
          if (forDepth === 0) {
            // Issue #2: Recursively expand inner FOR/ROF blocks before expanding
            const expandedLines = this.expandNestedFor(forBuffer.lines, equDefs, predefined);
            // Expand FOR block
            for (let i = 1; i <= forBuffer.count; i++) {
              if (forBuffer.label) {
                equDefs.set(forBuffer.label, String(i));
                forCounterNames.add(forBuffer.label);
              }
              for (const fline of expandedLines) {
                // Update CURLINE during pass 1 expansion (matches C's trav2 behavior)
                predefined.set('CURLINE', instrCount);
                // Issue #3: & concatenation operator (restricted to FOR counter variables, matching C's RSTACK)
                const processedLine = this.substituteAmpersand(fline, equDefs, predefined, forCounterNames);
                // Check if this is an EQU line - process as definition, not instruction
                const forTokens = this.tokenizeLine(processedLine);
                let forTokIdx = 0;
                let forLabel: string | null = null;
                while (forTokIdx < forTokens.length) {
                  const tok = forTokens[forTokIdx].toUpperCase();
                  if (this.isOpcode(tok) || tok === 'EQU') break;
                  let lbl = forTokens[forTokIdx];
                  if (lbl.endsWith(':')) lbl = lbl.slice(0, -1);
                  forLabel = lbl.toUpperCase();
                  forTokIdx++;
                }
                if (forTokIdx < forTokens.length && forTokens[forTokIdx].toUpperCase() === 'EQU' && forLabel) {
                  const equValue = forTokens.slice(forTokIdx + 1).join(' ');
                  equDefs.set(forLabel, equValue);
                  labels.set(forLabel, { name: forLabel, value: 0, isEqu: true, equText: equValue });
                  continue; // Don't add as instruction
                }
                instructions.push({ line: lineNum + 1, text: processedLine, rawLine });
                instrCount++;
              }
            }
            forBuffer = null;
            lastEquLabel = null;
            continue;
          }
        }
        if (upperLine.startsWith('FOR')) {
          forDepth++;
        }
        forBuffer.lines.push(line);
        continue;
      }

      // Parse labels, opcodes, EQU, FOR, ORG, END, PIN
      let labelName: string | null = null;
      const labelNames: string[] = [];
      let rest = line;

      // Extract label(s)
      const tokens = this.tokenizeLine(rest);
      if (tokens.length === 0) continue;

      let tokenIdx = 0;

      // Check for label(s) - support multiple labels per instruction (up to 7 like C's GRPMAX)
      while (tokenIdx < tokens.length) {
        const tok = tokens[tokenIdx].toUpperCase();
        if (this.isOpcode(tok) || tok === 'EQU' || tok === 'FOR' || tok === 'END' || tok === 'ORG' || tok === 'PIN') {
          break;
        }
        // It's a label
        let lbl = tokens[tokenIdx];
        if (lbl.endsWith(':')) lbl = lbl.slice(0, -1);
        labelName = lbl.toUpperCase();
        labelNames.push(labelName);
        tokenIdx++;
      }

      if (tokenIdx >= tokens.length) {
        // Label only, no instruction
        for (const lbl of labelNames) {
          labels.set(lbl, { name: lbl, value: instrCount, isEqu: false });
        }
        lastEquLabel = null;
        continue;
      }

      const opToken = tokens[tokenIdx].toUpperCase();

      if (opToken === 'EQU') {
        if (labelName) {
          const equValue = tokens.slice(tokenIdx + 1).join(' ');
          equDefs.set(labelName, equValue);
          labels.set(labelName, { name: labelName, value: 0, isEqu: true, equText: equValue });
          // Issue #1: start multi-line EQU tracking
          multiLineEquDefs.set(labelName, [equValue]);
          lastEquLabel = labelName;
        } else if (lastEquLabel) {
          // Issue #1: continuation EQU line (no new label, follows a previous EQU)
          const equValue = tokens.slice(tokenIdx + 1).join(' ');
          const existing = multiLineEquDefs.get(lastEquLabel) || [];
          existing.push(equValue);
          multiLineEquDefs.set(lastEquLabel, existing);
          // Update the label to indicate it's multi-line
          const label = labels.get(lastEquLabel);
          if (label) {
            label.equLines = existing;
          }
        } else {
          messages.push({ type: 'ERROR', line: lineNum + 1, text: 'EQU without label' });
          lastEquLabel = null;
        }
        continue;
      }

      lastEquLabel = null;

      if (opToken === 'FOR') {
        const countExpr = tokens.slice(tokenIdx + 1).join(' ');
        const substituted = this.substituteEqus(countExpr, equDefs, predefined);
        const evalResult = this.evaluator.evaluate(substituted);
        const count = evalResult.ok ? evalResult.value : 0;
        forBuffer = { label: labelName, count, lines: [] };
        forDepth = 1;
        continue;
      }

      if (opToken === 'ORG') {
        const offsetExpr = tokens.slice(tokenIdx + 1).join(' ');
        // Issue #10: Use absolute label values for ORG
        const substituted = this.substituteLabelsAndEqusAbsolute(offsetExpr, labels, equDefs, predefined);
        const evalResult = this.evaluator.evaluate(substituted);
        if (evalResult.ok) orgOffset = evalResult.value;
        continue;
      }

      if (opToken === 'END') {
        const offsetExpr = tokens.slice(tokenIdx + 1).join(' ');
        if (offsetExpr.trim()) {
          // Issue #10: Use absolute label values for END
          const substituted = this.substituteLabelsAndEqusAbsolute(offsetExpr, labels, equDefs, predefined);
          const evalResult = this.evaluator.evaluate(substituted);
          if (evalResult.ok && evalResult.value !== 0) {
            if (orgOffset !== 0) {
              // DOEERR: END offset ignored when ORG already set
              messages.push({ type: 'WARNING', line: lineNum + 1, text: 'END offset ignored, ORG already set' });
            } else {
              endOffset = evalResult.value;
            }
          }
        }
        break; // Stop processing after END
      }

      if (opToken === 'PIN') {
        const pinExpr = tokens.slice(tokenIdx + 1).join(' ');
        // Issue #10: Use absolute label values for PIN
        const substituted = this.substituteLabelsAndEqusAbsolute(pinExpr, labels, equDefs, predefined);
        const evalResult = this.evaluator.evaluate(substituted);
        if (evalResult.ok) pin = evalResult.value;
        continue;
      }

      // It's an instruction - register all labels for this line
      for (const lbl of labelNames) {
        labels.set(lbl, { name: lbl, value: instrCount, isEqu: false });
      }

      // Issue #1: Check if this is a reference to a multi-line EQU
      const instrText = tokens.slice(tokenIdx).join(' ');
      instructions.push({ line: lineNum + 1, text: instrText, rawLine });
      instrCount++;
    }

    if (endOffset !== null && orgOffset === 0) {
      orgOffset = endOffset;
    }

    // NASERR: warn when no ;assert directive is present
    if (!assertFound) {
      messages.push({ type: 'WARNING', line: 0, text: 'Missing ASSERT' });
    }

    // Issue #1: Expand multi-line EQU references in instructions
    const expandedInstructions = this.expandMultiLineEqus(instructions, multiLineEquDefs);

    // Check instruction count
    const finalInstrCount = expandedInstructions.length;
    if (finalInstrCount === 0) {
      messages.push({ type: 'ERROR', line: 0, text: 'No instructions found' });
      return { success: false, warrior: null, messages };
    }

    if (finalInstrCount > opts.maxLength) {
      messages.push({ type: 'WARNING', line: 0, text: `Warrior has ${finalInstrCount} instructions, limit is ${opts.maxLength}` });
    }

    // Rebuild labels with correct instruction indices after multi-line EQU expansion
    // Labels that point to instructions need to be recalculated if multi-line EQUs shifted things

    // Pass 2: assemble instructions
    const assembled: Instruction[] = [];

    for (let i = 0; i < expandedInstructions.length; i++) {
      const { line: lineNum, text } = expandedInstructions[i];
      // Issue #4: Set CURLINE predefined variable
      predefined.set('CURLINE', i);
      const result = this.assembleInstruction(text, i, finalInstrCount, labels, equDefs, predefined, opts.coreSize, lineNum, messages);
      if (result) {
        assembled.push(result);
      }
    }

    if (messages.some(m => m.type === 'ERROR')) {
      return { success: false, warrior: null, messages };
    }

    const startOffset = normalize(orgOffset, opts.coreSize);

    return {
      success: true,
      warrior: {
        instructions: assembled,
        startOffset,
        name,
        author,
        strategy,
        pin,
        warnings: messages.filter(m => m.type === 'WARNING').map(m => m.text),
      },
      messages,
    };
  }

  private assembleInstruction(
    text: string,
    instrIdx: number,
    totalInstr: number,
    labels: Map<string, Label>,
    equDefs: Map<string, string>,
    predefined: Map<string, number>,
    coreSize: number,
    lineNum: number,
    messages: AssemblerMessage[],
  ): Instruction | null {
    // Parse opcode, modifier, operands
    const tokens = this.tokenizeLine(text);
    if (tokens.length === 0) return null;

    let tokenIdx = 0;
    let opToken = tokens[tokenIdx].toUpperCase();

    // Parse opcode and optional modifier
    let opcodeStr: string;
    let modifierStr: string | null = null;

    const dotIdx = opToken.indexOf('.');
    if (dotIdx >= 0) {
      opcodeStr = opToken.substring(0, dotIdx);
      modifierStr = opToken.substring(dotIdx + 1);
      tokenIdx++;
    } else {
      opcodeStr = opToken;
      tokenIdx++;
      // Check if next token is a modifier (starts with .)
      if (tokenIdx < tokens.length && tokens[tokenIdx].startsWith('.')) {
        modifierStr = tokens[tokenIdx].substring(1).toUpperCase();
        tokenIdx++;
      }
    }

    const opcodeIdx = OPCODE_NAMES.indexOf(opcodeStr);
    if (opcodeIdx < 0) {
      messages.push({ type: 'ERROR', line: lineNum, text: `Unknown opcode: ${opcodeStr}` });
      return null;
    }
    const opcode = opcodeIdx as Opcode;

    // Gather remaining tokens as A and B operands
    const operandText = tokens.slice(tokenIdx).join(' ');
    const operands = this.splitOperands(operandText);

    let aMode = AddressMode.DIRECT;
    let bMode = AddressMode.DIRECT;
    let aExpr = '0';
    let bExpr = '0';

    if (operands.length >= 1) {
      // Substitute EQUs before parsing operand so addressing modes in EQU values (e.g. `<2667`) work
      const aText = this.substituteEquText(operands[0].trim(), equDefs, predefined);
      const parsed = this.parseOperand(aText);
      aMode = parsed.mode;
      aExpr = parsed.expr;
    }

    if (operands.length >= 2) {
      const bText = this.substituteEquText(operands[1].trim(), equDefs, predefined);
      const parsed = this.parseOperand(bText);
      bMode = parsed.mode;
      bExpr = parsed.expr;
    } else {
      // Default second operand for certain opcodes
      switch (opcode) {
        case Opcode.DAT:
          bMode = aMode;
          bExpr = aExpr;
          aMode = AddressMode.IMMEDIATE;
          aExpr = '0';
          break;
        case Opcode.JMP:
        case Opcode.SPL:
        case Opcode.NOP:
          bMode = AddressMode.DIRECT;
          bExpr = '0';
          break;
        default:
          messages.push({ type: 'ERROR', line: lineNum, text: `Missing operand for ${opcodeStr}` });
          return null;
      }
    }

    // Determine default modifier if not specified
    let modifier: Modifier;
    if (modifierStr) {
      const modIdx = MODIFIER_NAMES.indexOf(modifierStr);
      if (modIdx < 0) {
        messages.push({ type: 'ERROR', line: lineNum, text: `Unknown modifier: ${modifierStr}` });
        return null;
      }
      modifier = modIdx as Modifier;
    } else {
      modifier = this.defaultModifier(opcode, aMode, bMode);
    }

    // Evaluate expressions
    // Issue #7 & #8: pass messages for undefined symbol warnings and cycle detection
    const aSubstituted = this.substituteLabelsAndEqus(aExpr, instrIdx, totalInstr, labels, equDefs, predefined, messages, lineNum);
    const bSubstituted = this.substituteLabelsAndEqus(bExpr, instrIdx, totalInstr, labels, equDefs, predefined, messages, lineNum);

    const aResult = this.evaluator.evaluate(aSubstituted);
    const bResult = this.evaluator.evaluate(bSubstituted);

    let aValue = 0;
    let bValue = 0;

    if (aResult.ok) {
      aValue = normalize(aResult.value, coreSize);
    } else {
      messages.push({ type: 'ERROR', line: lineNum, text: `Bad A-field expression: ${aExpr} (${aResult.error})` });
      return null;
    }

    if (bResult.ok) {
      bValue = normalize(bResult.value, coreSize);
    } else {
      messages.push({ type: 'ERROR', line: lineNum, text: `Bad B-field expression: ${bExpr} (${bResult.error})` });
      return null;
    }

    return {
      opcode: encodeOpcode(opcode, modifier),
      aMode,
      bMode,
      aValue,
      bValue,
    };
  }

  private parseOperand(text: string): { mode: AddressMode; expr: string } {
    if (text.length === 0) return { mode: AddressMode.DIRECT, expr: '0' };

    const modeChar = text[0];
    const modeIdx = ADDRESS_MODE_SYMBOLS.indexOf(modeChar);
    if (modeIdx >= 0) {
      return { mode: modeIdx as AddressMode, expr: text.substring(1).trim() };
    }
    return { mode: AddressMode.DIRECT, expr: text };
  }

  private splitOperands(text: string): string[] {
    // Split on comma, respecting parentheses
    const result: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        result.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) result.push(current);
    return result;
  }

  private defaultModifier(opcode: Opcode, aMode: AddressMode, bMode: AddressMode): Modifier {
    switch (opcode) {
      case Opcode.DAT:
      case Opcode.NOP:
        return Modifier.F;
      case Opcode.MOV:
      case Opcode.CMP:
      case Opcode.SEQ:
      case Opcode.SNE:
        if (aMode === AddressMode.IMMEDIATE) return Modifier.AB;
        if (bMode === AddressMode.IMMEDIATE) return Modifier.B;
        return Modifier.I;
      case Opcode.ADD:
      case Opcode.SUB:
      case Opcode.MUL:
      case Opcode.DIV:
      case Opcode.MOD:
        if (aMode === AddressMode.IMMEDIATE) return Modifier.AB;
        if (bMode === AddressMode.IMMEDIATE) return Modifier.B;
        return Modifier.F;
      case Opcode.SLT:
      case Opcode.LDP:
      case Opcode.STP:
        if (aMode === AddressMode.IMMEDIATE) return Modifier.AB;
        return Modifier.B;
      default:
        return Modifier.B;
    }
  }

  private substituteLabelsAndEqus(
    expr: string,
    instrIdx: number,
    _totalInstr: number,
    labels: Map<string, Label>,
    equDefs: Map<string, string>,
    predefined: Map<string, number>,
    messages?: AssemblerMessage[],
    lineNum?: number,
    // Issue #8: cycle detection set
    visited?: Set<string>,
  ): string {
    // Replace label/EQU references with numeric values
    return expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (match) => {
      const upper = match.toUpperCase();

      // Check predefined
      if (predefined.has(upper)) {
        return String(predefined.get(upper));
      }

      // Issue #8: cycle detection
      const cycleSet = visited ?? new Set<string>();

      // Check EQU
      if (equDefs.has(upper)) {
        if (cycleSet.has(upper)) {
          // Cycle detected
          if (messages) {
            messages.push({ type: 'WARNING', line: lineNum ?? 0, text: `Recursive EQU cycle detected for ${upper}` });
          }
          return '0';
        }
        const newVisited = new Set(cycleSet);
        newVisited.add(upper);
        const equVal = equDefs.get(upper)!;
        // Recursively substitute
        return this.substituteLabelsAndEqus(equVal, instrIdx, _totalInstr, labels, equDefs, predefined, messages, lineNum, newVisited);
      }

      // Check labels
      if (labels.has(upper)) {
        const label = labels.get(upper)!;
        if (label.isEqu && label.equText) {
          if (cycleSet.has(upper)) {
            if (messages) {
              messages.push({ type: 'WARNING', line: lineNum ?? 0, text: `Recursive EQU cycle detected for ${upper}` });
            }
            return '0';
          }
          const newVisited = new Set(cycleSet);
          newVisited.add(upper);
          return this.substituteLabelsAndEqus(label.equText, instrIdx, _totalInstr, labels, equDefs, predefined, messages, lineNum, newVisited);
        }
        return String(label.value - instrIdx);
      }

      // Single character could be a register
      if (match.length === 1) return match;

      // Issue #7: undefined symbol warning
      if (messages) {
        messages.push({ type: 'WARNING', line: lineNum ?? 0, text: `Undefined symbol: ${match}` });
      }
      return '0';
    });
  }

  /**
   * Issue #10: Substitute labels with absolute values (for ORG/END/PIN directives)
   */
  private substituteLabelsAndEqusAbsolute(
    expr: string,
    labels: Map<string, Label>,
    equDefs: Map<string, string>,
    predefined: Map<string, number>,
  ): string {
    return expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (match) => {
      const upper = match.toUpperCase();

      if (predefined.has(upper)) {
        return String(predefined.get(upper));
      }

      if (equDefs.has(upper)) {
        return this.substituteLabelsAndEqusAbsolute(equDefs.get(upper)!, labels, equDefs, predefined);
      }

      if (labels.has(upper)) {
        const label = labels.get(upper)!;
        if (label.isEqu && label.equText) {
          return this.substituteLabelsAndEqusAbsolute(label.equText, labels, equDefs, predefined);
        }
        // Use absolute value (not relative)
        return String(label.value);
      }

      if (match.length === 1) return match;
      return '0';
    });
  }

  /**
   * Substitute EQU definitions as raw text macros (before addressing mode parsing).
   * This handles EQUs like `dmopa equ <2667` where the value includes an addressing mode.
   */
  private substituteEquText(text: string, equDefs: Map<string, string>, predefined: Map<string, number>, visited?: Set<string>): string {
    return text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (match) => {
      const upper = match.toUpperCase();
      if (equDefs.has(upper)) {
        const cycleSet = visited ?? new Set<string>();
        if (cycleSet.has(upper)) return match; // cycle detected
        const newVisited = new Set(cycleSet);
        newVisited.add(upper);
        return this.substituteEquText(equDefs.get(upper)!, equDefs, predefined, newVisited);
      }
      if (predefined.has(upper)) return String(predefined.get(upper));
      return match; // Leave labels as-is for later resolution
    });
  }

  private substituteEqus(expr: string, equDefs: Map<string, string>, predefined: Map<string, number>, visited?: Set<string>): string {
    return expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (match) => {
      const upper = match.toUpperCase();
      if (predefined.has(upper)) return String(predefined.get(upper));
      if (equDefs.has(upper)) {
        const cycleSet = visited ?? new Set<string>();
        if (cycleSet.has(upper)) return '0'; // cycle detected
        const newVisited = new Set(cycleSet);
        newVisited.add(upper);
        return this.substituteEqus(equDefs.get(upper)!, equDefs, predefined, newVisited);
      }
      if (match.length === 1) return match;
      return '0';
    });
  }

  /**
   * Issue #3: Replace &varname concatenation in FOR loop bodies.
   * If equDefs has 'I' = '3', then 'lab&I' becomes 'lab3'.
   */
  private substituteAmpersand(line: string, equDefs: Map<string, string>, predefined: Map<string, number>, forCounterNames: Set<string>): string {
    return line.replace(/&([A-Za-z_][A-Za-z0-9_]*)/g, (_match, varName: string) => {
      const upper = varName.toUpperCase();
      // C only substitutes & for RSTACK (FOR counter) variables
      if (forCounterNames.has(upper) && equDefs.has(upper)) {
        const val = equDefs.get(upper)!;
        // Match C's sprintf(buf, "%02u", value): zero-pad to 2 digits for numeric values
        const num = parseInt(val, 10);
        if (!isNaN(num) && String(num) === val) {
          return String(num).padStart(2, '0');
        }
        return val;
      }
      return '&' + varName;
    });
  }

  /**
   * Issue #2: Recursively expand nested FOR/ROF blocks within a list of lines.
   */
  private expandNestedFor(lines: string[], equDefs: Map<string, string>, predefined: Map<string, number>): string[] {
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const upperLine = lines[i].toUpperCase().trim();

      if (upperLine.startsWith('FOR')) {
        // Parse inner FOR
        const tokens = this.tokenizeLine(lines[i]);
        let labelName: string | null = null;
        let tokenIdx = 0;

        // Check for label before FOR
        while (tokenIdx < tokens.length) {
          const tok = tokens[tokenIdx].toUpperCase();
          if (tok === 'FOR') break;
          let lbl = tokens[tokenIdx];
          if (lbl.endsWith(':')) lbl = lbl.slice(0, -1);
          labelName = lbl.toUpperCase();
          tokenIdx++;
        }

        const countExpr = tokens.slice(tokenIdx + 1).join(' ');
        const substituted = this.substituteEqus(countExpr, equDefs, predefined);
        const evalResult = this.evaluator.evaluate(substituted);
        const count = evalResult.ok ? evalResult.value : 0;

        // Collect inner FOR body
        let depth = 1;
        const innerLines: string[] = [];
        i++;
        while (i < lines.length && depth > 0) {
          const innerUpper = lines[i].toUpperCase().trim();
          if (innerUpper.startsWith('ROF')) {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          if (innerUpper.startsWith('FOR')) {
            depth++;
          }
          innerLines.push(lines[i]);
          i++;
        }

        // Recursively expand the inner body
        const expandedInner = this.expandNestedFor(innerLines, equDefs, predefined);

        // Expand the inner FOR count times
        for (let j = 1; j <= count; j++) {
          if (labelName) {
            equDefs.set(labelName, String(j));
          }
          for (const fline of expandedInner) {
            result.push(fline);
          }
        }
      } else {
        result.push(lines[i]);
        i++;
      }
    }

    return result;
  }

  /**
   * Issue #1: Expand multi-line EQU references in instructions.
   * If an instruction line is simply a reference to a multi-line EQU label,
   * expand it into multiple instruction lines.
   */
  private expandMultiLineEqus(
    instructions: { line: number; text: string; rawLine: string }[],
    multiLineEquDefs: Map<string, string[]>,
  ): { line: number; text: string; rawLine: string }[] {
    const result: { line: number; text: string; rawLine: string }[] = [];

    for (const instr of instructions) {
      const trimmed = instr.text.trim().toUpperCase();
      // Check if the entire instruction is just a multi-line EQU reference
      if (multiLineEquDefs.has(trimmed) && multiLineEquDefs.get(trimmed)!.length > 1) {
        const equLines = multiLineEquDefs.get(trimmed)!;
        for (const equLine of equLines) {
          result.push({ line: instr.line, text: equLine, rawLine: instr.rawLine });
        }
      } else {
        result.push(instr);
      }
    }

    return result;
  }

  private tokenizeLine(line: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < line.length) {
      // Skip whitespace
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
      if (i >= line.length) break;

      let token = '';
      const ch = line[i];

      if (ch === ',' || ch === '.' || ch === '#' || ch === '$' || ch === '@' || ch === '<' || ch === '>' || ch === '*' || ch === '{' || ch === '}') {
        // Single char that merges with next token
        token = ch;
        i++;
        // For addressing modes, consume trailing expression chars
        if ('#$@<>*{}'.includes(ch)) {
          // Just the mode character
          tokens.push(token);
          continue;
        }
        // For dot (modifier separator), consume alpha chars
        if (ch === '.') {
          while (i < line.length && /[A-Za-z]/.test(line[i])) {
            token += line[i];
            i++;
          }
          tokens.push(token);
          continue;
        }
        tokens.push(token);
        continue;
      }

      // Alphanumeric or underscore tokens (identifiers, opcodes, numbers)
      if (/[A-Za-z0-9_]/.test(ch)) {
        while (i < line.length && /[A-Za-z0-9_:]/.test(line[i])) {
          token += line[i];
          i++;
        }
        // Check for attached modifier like "MOV.I"
        if (i < line.length && line[i] === '.') {
          token += '.';
          i++;
          while (i < line.length && /[A-Za-z]/.test(line[i])) {
            token += line[i];
            i++;
          }
        }
        tokens.push(token);
        continue;
      }

      // Expression characters
      if ('()+-/%!= '.includes(ch)) {
        token = ch;
        i++;
        tokens.push(token);
        continue;
      }

      // Unknown char, skip
      i++;
    }
    return tokens;
  }

  private isOpcode(token: string): boolean {
    return OPCODE_NAMES.includes(token) || token.includes('.') && OPCODE_NAMES.includes(token.split('.')[0]);
  }
}

export function disassemble(inst: Instruction, coreSize: number): string {
  const { opcode, modifier } = decodeOpcode(inst.opcode);
  const opName = OPCODE_NAMES[opcode] || '???';
  const modName = MODIFIER_NAMES[modifier] || '??';
  const aSymbol = ADDRESS_MODE_SYMBOLS[inst.aMode] || '$';
  const bSymbol = ADDRESS_MODE_SYMBOLS[inst.bMode] || '$';

  const denorm = (v: number) => v > coreSize / 2 ? v - coreSize : v;

  return `${opName}.${modName} ${aSymbol}${denorm(inst.aValue)}, ${bSymbol}${denorm(inst.bValue)}`;
}
