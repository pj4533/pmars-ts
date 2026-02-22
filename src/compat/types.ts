export enum ModeType {
  Immediate = '#',
  Direct = '$',
  AIndirect = '*',
  BIndirect = '@',
  APreDecrement = '{',
  BPreDecrement = '<',
  APostIncrement = '}',
  BPostIncrement = '>',
}

export enum OpcodeType {
  DAT = 'DAT',
  MOV = 'MOV',
  ADD = 'ADD',
  SUB = 'SUB',
  MUL = 'MUL',
  DIV = 'DIV',
  MOD = 'MOD',
  JMP = 'JMP',
  JMZ = 'JMZ',
  JMN = 'JMN',
  DJN = 'DJN',
  CMP = 'CMP',
  SEQ = 'SEQ',
  SNE = 'SNE',
  SLT = 'SLT',
  SPL = 'SPL',
  NOP = 'NOP',
  LDP = 'LDP',
  STP = 'STP',
}

export enum ModifierType {
  A = 'A',
  B = 'B',
  AB = 'AB',
  BA = 'BA',
  F = 'F',
  X = 'X',
  I = 'I',
}

export interface IOperand {
  mode: ModeType;
  address: number;
}

export interface IInstruction {
  address: number;
  opcode: OpcodeType;
  modifier: ModifierType;
  aOperand: IOperand;
  bOperand: IOperand;
}

export interface IOptions {
  coresize?: number;
  maximumCycles?: number;
  initialInstruction?: IInstruction;
  instructionLimit?: number;
  maxTasks?: number;
  minSeparation?: number;
  standard?: number;
  readLimit?: number;
  writeLimit?: number;
  pSpaceSize?: number;
  seed?: number | null;
  rounds?: number;
  fixedSeries?: boolean;
  fixedPosition?: number | null;
}

export interface IMetaData {
  name: string;
  author: string;
  strategy: string;
}

export enum MessageType {
  Error = 'ERROR',
  Warning = 'WARNING',
  Info = 'INFO',
}

export enum TokenCategory {
  Label = 'LABEL',
  Opcode = 'OPCODE',
  Preprocessor = 'PREPROCESSOR',
  Modifier = 'MODIFIER',
  Mode = 'MODE',
  Number = 'NUMBER',
  Comma = 'COMMA',
  Maths = 'MATHS',
  EOL = 'EOL',
  Comment = 'COMMENT',
}

export interface IPosition {
  line: number;
  char: number;
}

export interface IMessage {
  type: MessageType;
  position: IPosition;
  text: string;
}

export interface IToken {
  position: IPosition;
  lexeme: string;
  category: TokenCategory;
}

export interface IParseResult {
  metaData: IMetaData;
  tokens: IToken[];
  messages: IMessage[];
  success: boolean;
}

export interface IWarrior {
  source: IParseResult;
  data?: string;
}

export interface IPublishProvider {
  publishSync(type: string, payload: unknown): void;
}

export interface IRoundResult {
  winnerId?: number;
  winnerData?: unknown;
  outcome: 'WIN' | 'TIE';
}

export enum CoreAccessType {
  read = 'READ',
  write = 'WRITE',
  execute = 'EXECUTE',
}

export interface ICoreAccessEventArgs {
  warriorId?: number;
  address: number;
  accessType: CoreAccessType;
}

export interface ICoreLocation {
  instruction: IInstruction;
  access: ICoreAccessEventArgs;
}

export interface IRules {
  rounds: number;
  options: IOptions;
  scoreFormula?: (wins: number, losses: number, draws: number, numWarriors: number) => number;
}

export interface IMatchWarrior {
  warriorMatchId?: number;
  source: IParseResult;
  wins?: number;
}

export interface IMatchWarriorResult {
  warrior: IWarrior;
  won: number;
  drawn: number;
  lost: number;
  given: number;
  taken: number;
}

export interface IMatchResult {
  rounds: number;
  warriors: IMatchWarriorResult[];
}

export interface IHillWarriorResult {
  warrior: IWarrior;
  rank: number;
  score: number;
  won: number;
  drawn: number;
  lost: number;
  matches: IMatchResult[];
}

export interface IHillResult {
  warriors: IHillWarriorResult[];
}
