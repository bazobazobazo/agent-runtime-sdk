export type OpenClawCronJob = {
  id: string;
  spec?: string;
  enabled?: boolean;
  raw?: unknown;
};

export type OpenClawCronAddInput = {
  name: string;
  schedule: string;
  instruction: string;
  timezone?: string;
  metadata?: Record<string, string>;
};

export interface OpenClawCronExtension {
  status(): Promise<unknown>;
  add(input: OpenClawCronAddInput): Promise<OpenClawCronJob>;
  remove(jobId: string): Promise<void>;
  list(): Promise<OpenClawCronJob[]>;
  runs(jobId?: string): Promise<unknown[]>;
}
