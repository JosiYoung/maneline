import { Field } from './shared';
import { grid2, hr, inputStyle } from './styles';

export interface OwnerStep2Data {
  location: string;
  owner_discipline: string;
  include_horse: boolean;
  barn_name: string;
  breed: string;
  sex: string;
  year_born: string;
  horse_discipline: string;
  marketing_opt_in: boolean;
}

export const emptyOwnerStep2 = (): OwnerStep2Data => ({
  location: '',
  owner_discipline: '',
  include_horse: true,
  barn_name: '',
  breed: '',
  sex: '',
  year_born: '',
  horse_discipline: '',
  marketing_opt_in: true,
});

export function OwnerStep({
  data, setData,
}: {
  data: OwnerStep2Data;
  setData: (d: OwnerStep2Data) => void;
}) {
  return (
    <>
      <div style={grid2}>
        <Field label="State / Region">
          <input
            type="text"
            value={data.location}
            onChange={(e) => setData({ ...data, location: e.target.value })}
            style={inputStyle}
            placeholder="Texas, Wyoming, Alberta..."
          />
        </Field>
        <Field label="What do you do with horses? (optional)">
          <select
            value={data.owner_discipline}
            onChange={(e) => setData({ ...data, owner_discipline: e.target.value })}
            style={inputStyle}
          >
            <option value="">Choose one</option>
            <option>Barrel racing</option><option>Roping / team roping</option>
            <option>Ranch work</option><option>Cutting / reining</option>
            <option>Trail / pleasure</option><option>Breeding / foaling</option>
            <option>Show / hunter-jumper</option><option>Dressage / eventing</option>
            <option>Endurance</option><option>Other</option>
          </select>
        </Field>
      </div>

      <hr style={hr} />

      <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 500, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={data.include_horse}
          onChange={(e) => setData({ ...data, include_horse: e.target.checked })}
          style={{ width: 'auto' }}
        />
        <span>Add my first horse now (optional — you can skip and add later)</span>
      </label>

      {data.include_horse && (
        <div style={{ marginTop: 14 }}>
          <div style={grid2}>
            <Field label="Barn name">
              <input type="text" value={data.barn_name}
                onChange={(e) => setData({ ...data, barn_name: e.target.value })}
                style={inputStyle} placeholder="Stingray" />
            </Field>
            <Field label="Breed">
              <select value={data.breed}
                onChange={(e) => setData({ ...data, breed: e.target.value })} style={inputStyle}>
                <option value="">Choose breed</option>
                <option>Quarter Horse</option><option>Paint</option><option>Appaloosa</option>
                <option>Thoroughbred</option><option>Arabian</option><option>Warmblood</option>
                <option>Morgan</option><option>Tennessee Walker</option><option>Mustang</option>
                <option>Draft</option><option>Pony</option><option>Mixed / unknown</option><option>Other</option>
              </select>
            </Field>
          </div>
          <Field label="Sex">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {['mare', 'gelding', 'stallion'].map((v) => (
                <label key={v} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: 'var(--color-bg)', border: '1.5px solid var(--color-line)', borderRadius: 10,
                  cursor: 'pointer', fontWeight: 500,
                }}>
                  <input
                    type="radio" name="sex" value={v} checked={data.sex === v}
                    onChange={(e) => setData({ ...data, sex: e.target.value })}
                    style={{ width: 'auto', margin: 0 }}
                  />
                  {v[0].toUpperCase() + v.slice(1)}
                </label>
              ))}
            </div>
          </Field>
          <div style={grid2}>
            <Field label="Year born">
              <input type="number" min={1990} max={2026} value={data.year_born}
                onChange={(e) => setData({ ...data, year_born: e.target.value })}
                style={inputStyle} placeholder="2018" />
            </Field>
            <Field label="Primary discipline">
              <select value={data.horse_discipline}
                onChange={(e) => setData({ ...data, horse_discipline: e.target.value })} style={inputStyle}>
                <option value="">Choose one</option>
                <option>Barrel racing</option><option>Roping</option><option>Ranch work</option>
                <option>Cutting / reining</option><option>Trail / pleasure</option><option>Breeding</option>
                <option>Show</option><option>Dressage / eventing</option><option>Endurance</option>
                <option>Retired / companion</option><option>Other</option>
              </select>
            </Field>
          </div>
        </div>
      )}

      <hr style={hr} />
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500 }}>
        <input type="checkbox" checked={data.marketing_opt_in}
          onChange={(e) => setData({ ...data, marketing_opt_in: e.target.checked })}
          style={{ width: 'auto', marginTop: 3 }} />
        <span style={{ fontSize: 13.5, color: '#2a3130' }}>
          Send me product updates from Mane Line. Unsubscribe anytime.
        </span>
      </label>
    </>
  );
}
