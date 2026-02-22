import { type Instruction, type WarriorData, type SimulatorOptions, DEFAULT_OPTIONS, Opcode, Modifier, AddressMode, OPCODE_NAMES, MODIFIER_NAMES, ADDRESS_MODE_SYMBOLS } from '../types.js';
import { encodeOpcode, decodeOpcode } from '../constants.js';
import { ExpressionEvaluator } from './expression.js';
import { normalize } from '../utils/modular-arithmetic.js';

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
    const lines = source.split('\n');

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
    predefined.set('PSPACESIZE', opts.pSpaceSize);

    // Pass 1: collect labels, EQUs, metadata, and instruction lines
    let instrCount = 0;
    const equDefs: Map<string, string> = new Map();
    let forDepth = 0;
    let forBuffer: { label: string | null; count: number; lines: string[] } | null = null;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      let line = lines[lineNum];
      const rawLine = line;

      // Handle comments at the start of the line (metadata directives)
      const trimmed = line.trim();
      if (trimmed.startsWith(';')) {
        const directive = trimmed.substring(1).trim();
        const upperDir = directive.toUpperCase();

        if (upperDir.startsWith('REDCODE')) continue;
        if (upperDir.startsWith('NAME')) {
          name = directive.substring(4).trim() || 'Unknown';
          continue;
        }
        if (upperDir.startsWith('AUTHOR')) {
          author = directive.substring(6).trim() || 'Anonymous';
          continue;
        }
        if (upperDir.startsWith('STRATEGY')) {
          strategy += (strategy ? '\n' : '') + directive.substring(8).trim();
          continue;
        }
        if (upperDir.startsWith('ASSERT')) continue;
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
            // Expand FOR block
            for (let i = 1; i <= forBuffer.count; i++) {
              if (forBuffer.label) {
                equDefs.set(forBuffer.label, String(i));
              }
              for (const fline of forBuffer.lines) {
                instructions.push({ line: lineNum + 1, text: fline, rawLine });
                instrCount++;
              }
            }
            forBuffer = null;
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
      let rest = line;

      // Extract label(s)
      const tokens = this.tokenizeLine(rest);
      if (tokens.length === 0) continue;

      let tokenIdx = 0;

      // Check for label
      while (tokenIdx < tokens.length) {
        const tok = tokens[tokenIdx].toUpperCase();
        if (this.isOpcode(tok) || tok === 'EQU' || tok === 'FOR' || tok === 'END' || tok === 'ORG' || tok === 'PIN') {
          break;
        }
        // It's a label
        let lbl = tokens[tokenIdx];
        if (lbl.endsWith(':')) lbl = lbl.slice(0, -1);
        labelName = lbl.toUpperCase();
        tokenIdx++;
      }

      if (tokenIdx >= tokens.length) {
        // Label only, no instruction
        if (labelName) {
          labels.set(labelName, { name: labelName, value: instrCount, isEqu: false });
        }
        continue;
      }

      const opToken = tokens[tokenIdx].toUpperCase();

      if (opToken === 'EQU') {
        if (labelName) {
          const equValue = tokens.slice(tokenIdx + 1).join(' ');
          equDefs.set(labelName, equValue);
          labels.set(labelName, { name: labelName, value: 0, isEqu: true, equText: equValue });
        } else {
          messages.push({ type: 'ERROR', line: lineNum + 1, text: 'EQU without label' });
        }
        continue;
      }

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
        const substituted = this.substituteEqus(offsetExpr, equDefs, predefined);
        const evalResult = this.evaluator.evaluate(substituted);
        if (evalResult.ok) orgOffset = evalResult.value;
        continue;
      }

      if (opToken === 'END') {
        const offsetExpr = tokens.slice(tokenIdx + 1).join(' ');
        if (offsetExpr.trim()) {
          const substituted = this.substituteEqus(offsetExpr, equDefs, predefined);
          const evalResult = this.evaluator.evaluate(substituted);
          if (evalResult.ok && evalResult.value !== 0) endOffset = evalResult.value;
        }
        break; // Stop processing after END
      }

      if (opToken === 'PIN') {
        const pinExpr = tokens.slice(tokenIdx + 1).join(' ');
        const substituted = this.substituteEqus(pinExpr, equDefs, predefined);
        const evalResult = this.evaluator.evaluate(substituted);
        if (evalResult.ok) pin = evalResult.value;
        continue;
      }

      // It's an instruction
      if (labelName) {
        labels.set(labelName, { name: labelName, value: instrCount, isEqu: false });
      }
      const instrText = tokens.slice(tokenIdx).join(' ');
      instructions.push({ line: lineNum + 1, text: instrText, rawLine });
      instrCount++;
    }

    if (endOffset !== null && orgOffset === 0) {
      orgOffset = endOffset;
    }

    // Check instruction count
    if (instrCount === 0) {
      messages.push({ type: 'ERROR', line: 0, text: 'No instructions found' });
      return { success: false, warrior: null, messages };
    }

    if (instrCount > opts.maxLength) {
      messages.push({ type: 'WARNING', line: 0, text: `Warrior has ${instrCount} instructions, limit is ${opts.maxLength}` });
    }

    // Pass 2: assemble instructions
    const assembled: Instruction[] = [];

    for (let i = 0; i < instructions.length; i++) {
      const { line: lineNum, text } = instructions[i];
      const result = this.assembleInstruction(text, i, instrCount, labels, equDefs, predefined, opts.coreSize, lineNum, messages);
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
    const aSubstituted = this.substituteLabelsAndEqus(aExpr, instrIdx, totalInstr, labels, equDefs, predefined);
    const bSubstituted = this.substituteLabelsAndEqus(bExpr, instrIdx, totalInstr, labels, equDefs, predefined);

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
  ): string {
    // Replace label/EQU references with numeric values
    return expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (match) => {
      const upper = match.toUpperCase();

      // Check predefined
      if (predefined.has(upper)) {
        return String(predefined.get(upper));
      }

      // Check EQU
      if (equDefs.has(upper)) {
        const equVal = equDefs.get(upper)!;
        // Recursively substitute
        return this.substituteLabelsAndEqus(equVal, instrIdx, _totalInstr, labels, equDefs, predefined);
      }

      // Check labels
      if (labels.has(upper)) {
        const label = labels.get(upper)!;
        if (label.isEqu && label.equText) {
          return this.substituteLabelsAndEqus(label.equText, instrIdx, _totalInstr, labels, equDefs, predefined);
        }
        return String(label.value - instrIdx);
      }

      // Single character could be a register
      if (match.length === 1) return match;

      return '0';
    });
  }

  /**
   * Substitute EQU definitions as raw text macros (before addressing mode parsing).
   * This handles EQUs like `dmopa equ <2667` where the value includes an addressing mode.
   */
  private substituteEquText(text: string, equDefs: Map<string, string>, predefined: Map<string, number>): string {
    return text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (match) => {
      const upper = match.toUpperCase();
      if (equDefs.has(upper)) {
        return this.substituteEquText(equDefs.get(upper)!, equDefs, predefined);
      }
      if (predefined.has(upper)) return String(predefined.get(upper));
      return match; // Leave labels as-is for later resolution
    });
  }

  private substituteEqus(expr: string, equDefs: Map<string, string>, predefined: Map<string, number>): string {
    return expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (match) => {
      const upper = match.toUpperCase();
      if (predefined.has(upper)) return String(predefined.get(upper));
      if (equDefs.has(upper)) return this.substituteEqus(equDefs.get(upper)!, equDefs, predefined);
      if (match.length === 1) return match;
      return '0';
    });
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
