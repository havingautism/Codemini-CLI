import { t } from '../../../i18n/index.js';
import { APPEARANCE_PALETTES } from '@/lib/appearance-palettes.js';
import { SettingsSection } from './SettingsSection.jsx';
import { SettingsField } from './SettingsField.jsx';
import { SettingsChoiceList } from './SettingsChoiceList.jsx';
import { SettingsSegmentedControl } from './SettingsSegmentedControl.jsx';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export function SettingsAppearance({ value, onChange, disabled }) {
  const change = (key, next) => onChange({ ...value, [key]: next });
  return (
    <SettingsSection description={t('appearanceHelp')}>
      <SettingsField id="appearance-mode" label={t('appearanceMode')}>
        <SettingsSegmentedControl
          idPrefix="appearance-mode"
          label={t('appearanceMode')}
          value={value.mode}
          disabled={disabled}
          onValueChange={(mode) => change('mode', mode)}
          options={['light', 'dark', 'auto'].map((mode) => ({ value: mode, label: t({light: 'lightMode', dark: 'darkMode', auto: 'autoModeTheme'}[mode]) }))}
        />
      </SettingsField>
      <SettingsField id="appearance-palette" label={t('appearancePalette')} description={t('appearancePaletteHelp')}>
        <ToggleGroup id="appearance-palette" aria-label={t('appearancePalette')} type="single" size="auto" value={value.palette} onValueChange={(palette) => palette && change('palette', palette)} disabled={disabled} className="settings-palette-grid">
          {APPEARANCE_PALETTES.map((palette) => (
            <ToggleGroupItem key={palette.id} value={palette.id} className="settings-palette-card" aria-label={t(palette.labelKey)}>
              <span className="settings-palette-card__name">{t(palette.labelKey)}</span>
              <span className="settings-palette-card__samples" aria-hidden="true">
                {['light', 'dark'].map((mode) => (
                  <span key={mode} className="settings-palette-card__sample">
                    <span className="settings-palette-card__mode">{t(mode === 'light' ? 'lightMode' : 'darkMode')}</span>
                    <span className="settings-palette-card__swatches">
                      {['canvas', 'surface', 'accent', 'text'].map((color) => <span key={color} style={{backgroundColor:palette[mode][color]}} />)}
                    </span>
                  </span>
                ))}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsField>
      <SettingsField id="appearance-font" label={t('appearanceFont')} description={t('appearanceFontHelp')}>
        <SettingsChoiceList
          idPrefix="appearance-font"
          label={t('appearanceFont')}
          value={value.font}
          disabled={disabled}
          onValueChange={(font) => change('font', font)}
          options={[
            { value: 'sans', label: t('appearanceSans'), description: 'Inter · Noto Sans SC' },
            { value: 'serif', label: t('appearanceSerif'), description: 'Source Serif 4 · Noto Serif SC' },
            { value: 'system', label: t('appearanceSystemFont'), description: t('appearanceSystemFontHelp') },
          ]}
        />
      </SettingsField>
    </SettingsSection>
  );
}
