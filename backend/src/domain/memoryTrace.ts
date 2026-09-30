export interface MemoryTraceVariable {
  id: string;
  name: string;
  type: string;
  value: string;
  pointer: boolean;
  heap: boolean;
  depth: number;
}

export interface MemoryTraceBlock {
  address: string;
  type: string;
  freed: boolean;
}

export interface MemoryTraceStep {
  line: number;
  sequence: number;
  variables: MemoryTraceVariable[];
  heap: MemoryTraceBlock[];
}

export interface MemoryTraceResponse {
  steps: MemoryTraceStep[];
  traceable: boolean;
  message: string | null;
  stderr: string;
}
