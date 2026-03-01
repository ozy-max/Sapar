export type ConfigType = 'INT' | 'FLOAT' | 'BOOL' | 'STRING' | 'JSON';

export interface ConfigEntity {
  key: string;
  type: ConfigType;
  valueJson: unknown;
  description?: string | null;
  scope?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
