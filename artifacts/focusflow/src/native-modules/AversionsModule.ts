import { NativeModules } from 'react-native';

const { Aversions } = NativeModules;

export interface AversionsSettings {
  dimmerEnabled: boolean;
  vibrateEnabled: boolean;
  soundEnabled: boolean;
  weeklyReportEnabled: boolean;
}

const AversionsModule = {
  async getSettings(): Promise<AversionsSettings> {
    return Aversions.getSettings();
  },

  async setSettings(settings: Partial<AversionsSettings>): Promise<void> {
    return Aversions.setSettings(settings);
  },
};

export { AversionsModule };
