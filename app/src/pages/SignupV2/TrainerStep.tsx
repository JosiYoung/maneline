import { Field, emptyRef, type TrainerRef } from './shared';
import { grid2, hr, inputStyle } from './styles';

export interface TrainerStep2Data {
  business_name: string;
  years_training: string;
  primary_discipline: string;
  certifications: string; // newline-separated; normalized to string[] at submit
  insurance_carrier: string;
  bio: string;
  reference_1: TrainerRef;
  reference_2: TrainerRef;
  consent_vetting: boolean;
  marketing_opt_in: boolean;
}

export const emptyTrainerStep2 = (): TrainerStep2Data => ({
  business_name: '',
  years_training: '',
  primary_discipline: '',
  certifications: '',
  insurance_carrier: '',
  bio: '',
  reference_1: emptyRef(),
  reference_2: emptyRef(),
  consent_vetting: false,
  marketing_opt_in: true,
});

export function TrainerStep({
  data, setData,
}: {
  data: TrainerStep2Data;
  setData: (d: TrainerStep2Data) => void;
}) {
  return (
    <>
      <div style={grid2}>
        <Field label="Business / barn name *">
          <input
            type="text" required value={data.business_name}
            onChange={(e) => setData({ ...data, business_name: e.target.value })}
            style={inputStyle} placeholder="Cervi Performance Horses"
          />
        </Field>
        <Field label="Years training *">
          <input
            type="number" min={0} max={80} required value={data.years_training}
            onChange={(e) => setData({ ...data, years_training: e.target.value })}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Primary discipline *">
        <select required value={data.primary_discipline}
          onChange={(e) => setData({ ...data, primary_discipline: e.target.value })}
          style={inputStyle}>
          <option value="">Choose one</option>
          <option>Barrel racing</option><option>Roping / team roping</option>
          <option>Ranch work</option><option>Cutting / reining</option>
          <option>Trail / pleasure</option><option>Breeding / foaling</option>
          <option>Show / hunter-jumper</option><option>Dressage / eventing</option>
          <option>Endurance</option><option>Other</option>
        </select>
      </Field>

      <Field label="Certifications (one per line)">
        <textarea
          value={data.certifications}
          onChange={(e) => setData({ ...data, certifications: e.target.value })}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          placeholder={'AQHA Professional Horseman\nPATH Intl. Registered Instructor'}
        />
      </Field>

      <Field label="Insurance carrier *">
        <input
          type="text" required value={data.insurance_carrier}
          onChange={(e) => setData({ ...data, insurance_carrier: e.target.value })}
          style={inputStyle} placeholder="Markel, Equisure, Hallmark, self-insured..."
        />
      </Field>

      <Field label="Short bio (optional)">
        <textarea
          value={data.bio}
          onChange={(e) => setData({ ...data, bio: e.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          placeholder="Shown to owners when they consider granting you access to their animals."
        />
      </Field>

      <hr style={hr} />
      <h3 style={{ fontSize: 18, marginBottom: 6 }}>Two references *</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
        Clients, mentors, or colleagues who can vouch for your work. Silver Lining may reach out.
      </p>

      <ReferenceBlock
        index={1}
        value={data.reference_1}
        onChange={(r) => setData({ ...data, reference_1: r })}
      />
      <ReferenceBlock
        index={2}
        value={data.reference_2}
        onChange={(r) => setData({ ...data, reference_2: r })}
      />

      <hr style={hr} />
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500 }}>
        <input type="checkbox" required checked={data.consent_vetting}
          onChange={(e) => setData({ ...data, consent_vetting: e.target.checked })}
          style={{ width: 'auto', marginTop: 3 }} />
        <span style={{ fontSize: 13.5, color: '#2a3130' }}>
          I agree to a vetting review by the Silver Lining team. My account stays in
          pending-review status until approved. *
        </span>
      </label>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500, marginTop: 10 }}>
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

function ReferenceBlock({
  index, value, onChange,
}: {
  index: number;
  value: TrainerRef;
  onChange: (r: TrainerRef) => void;
}) {
  return (
    <fieldset style={{ border: '1px solid var(--color-line)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <legend style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-primary)', padding: '0 6px' }}>
        Reference {index}
      </legend>
      <div style={grid2}>
        <Field label="Name *">
          <input type="text" required value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Phone or email *">
          <input type="text" required value={value.contact}
            onChange={(e) => onChange({ ...value, contact: e.target.value })} style={inputStyle} />
        </Field>
      </div>
      <Field label="Relationship">
        <input type="text" value={value.relationship}
          onChange={(e) => onChange({ ...value, relationship: e.target.value })}
          style={inputStyle} placeholder="Client of 4 years, mentor, barn owner..." />
      </Field>
    </fieldset>
  );
}
