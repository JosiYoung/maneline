import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import {
  MAX_UPLOAD_BYTES,
  VET_RECORD_MIME,
  commitUpload,
  mapUploadError,
  requestPresign,
  uploadToR2,
} from "@/lib/uploads";
import { VET_RECORDS_QUERY_KEY, RECORD_TYPES, type VetRecordType } from "@/lib/vetRecords";

// RecordsUploader — single-file vet_record upload.
//
// Flow: pick file → fill metadata → Upload → requestPresign → uploadToR2
// (with progress) → commitUpload. Concurrent files would muddy the
// metadata form; Phase 1 keeps it one-at-a-time. A multi-file bulk
// import is easy to bolt on later.
export function RecordsUploader({
  animalId,
  animalName,
  onUploaded,
}: {
  animalId: string;
  animalName: string;
  onUploaded?: () => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [recordType, setRecordType] = useState<VetRecordType>("coggins");
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [issuingProvider, setIssuingProvider] = useState("");
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Pick a file first.");
      setProgress(0);
      const presign = await requestPresign({
        kind: "vet_record",
        contentType: file.type,
        byteSize: file.size,
        animalId,
      });
      await uploadToR2(presign.put_url, file, (f) => setProgress(f));
      return commitUpload({
        kind: "vet_record",
        object_key: presign.object_key,
        animal_id: animalId,
        record_type: recordType,
        issued_on: issuedOn || null,
        expires_on: expiresOn || null,
        issuing_provider: issuingProvider.trim() || null,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: VET_RECORDS_QUERY_KEY });
      notify.success(`${prettyRecordType(recordType)} uploaded for ${animalName}.`);
      resetForm();
      onUploaded?.();
    },
    onError: (err) => {
      setProgress(null);
      notify.error(mapUploadError(err));
    },
  });

  function resetForm() {
    setFile(null);
    setRecordType("coggins");
    setIssuedOn("");
    setExpiresOn("");
    setIssuingProvider("");
    setNotes("");
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function validateAndSet(candidate: File | null | undefined) {
    if (!candidate) return;
    if (!VET_RECORD_MIME.has(candidate.type)) {
      notify.error("Only PDF, JPEG, PNG, or HEIC files are allowed.");
      return;
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      notify.error("File is over 25 MB. Please upload a smaller copy.");
      return;
    }
    setFile(candidate);
  }

  const disabled = upload.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        upload.mutate();
      }}
      className="space-y-4"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          validateAndSet(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm transition-colors",
          dragOver
            ? "border-primary bg-muted"
            : "border-border bg-card hover:border-primary"
        )}
      >
        <FileUp size={28} className="text-muted-foreground" />
        <p className="font-medium text-foreground">
          {file ? file.name : "Drop a file or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground">
          PDF, JPEG, PNG, or HEIC · up to 25 MB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/heic"
          className="hidden"
          onChange={(e) => validateAndSet(e.target.files?.[0] ?? null)}
        />
      </div>

      {file ? (
        <button
          type="button"
          onClick={resetForm}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
          disabled={disabled}
        >
          <X size={14} />
          Remove file
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="record_type">Type</Label>
          <select
            id="record_type"
            value={recordType}
            onChange={(e) => setRecordType(e.target.value as VetRecordType)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm disabled:opacity-50"
            disabled={disabled}
          >
            {RECORD_TYPES.map((t) => (
              <option key={t} value={t}>
                {prettyRecordType(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="issuing_provider">Issued by</Label>
          <Input
            id="issuing_provider"
            value={issuingProvider}
            onChange={(e) => setIssuingProvider(e.target.value)}
            placeholder="Dr. Haynes, Big Sky Vet"
            disabled={disabled}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="issued_on">Issued on</Label>
          <Input
            id="issued_on"
            type="date"
            value={issuedOn}
            onChange={(e) => setIssuedOn(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expires_on">Expires on</Label>
          <Input
            id="expires_on"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any details a vet or buyer would want to see."
          rows={3}
          disabled={disabled}
        />
      </div>

      {progress != null ? (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {progress < 1 ? "Uploading…" : "Finalizing…"}
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <Button
          type="submit"
          disabled={!file || disabled}
        >
          {disabled ? "Uploading…" : "Upload record"}
        </Button>
      </div>
    </form>
  );
}

function prettyRecordType(t: VetRecordType): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
