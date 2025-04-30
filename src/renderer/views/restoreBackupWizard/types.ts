import { Server } from "../../types";

export interface RestoreBackupSetupData {
  server: Server | null,
  username: string,
  password: string,
}