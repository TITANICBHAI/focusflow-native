import { NativeModules } from 'react-native';

const { Greyout } = NativeModules;

export interface GreyoutWindow {
  pkg: string;
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
  days: number[];
}

export interface TemptationEntry {
  pkg: string;
  appName: string;
  timestamp: number;
}

const GreyoutModule = {
  async getSchedule(): Promise<GreyoutWindow[]> {
    const json: string = await Greyout.getSchedule();
    try { return JSON.parse(json) as GreyoutWindow[]; } catch { return []; }
  },

  async setSchedule(windows: GreyoutWindow[]): Promise<void> {
    return Greyout.setSchedule(JSON.stringify(windows));
  },

  async getTemptationLog(): Promise<TemptationEntry[]> {
    const json: string = await Greyout.getTemptationLog();
    try { return JSON.parse(json) as TemptationEntry[]; } catch { return []; }
  },

  async clearTemptationLog(): Promise<void> {
    return Greyout.clearTemptationLog();
  },

  async getWeeklySummary(): Promise<string> {
    return Greyout.getWeeklySummary();
  },
};

export { GreyoutModule };
