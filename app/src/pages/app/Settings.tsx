import { PinSettings } from "../../components/PinSettings";

// Settings — /app/settings. Not in BottomNav (we keep that to four
// owner-primary slots). Reached from PortalHeader in a later phase.
// Today this page is just the PinSettings block that used to live on
// OwnerIndex.
export default function Settings() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-primary">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account preferences and PIN-login.
        </p>
      </header>

      <PinSettings />
    </div>
  );
}
