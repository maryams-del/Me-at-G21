import { AuthFrame } from "../AuthFrame";
import { RecoverClient } from "./RecoverClient";

export default function RecoverPage() {
  return (
    <AuthFrame title="Recover access">
      <RecoverClient />
    </AuthFrame>
  );
}
