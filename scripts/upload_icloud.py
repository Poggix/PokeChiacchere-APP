import os
import sys
from pathlib import Path

from pyicloud import PyiCloudService


def main():
    username = os.environ["ICLOUD_USERNAME"]
    password = os.environ["ICLOUD_PASSWORD"]
    folder_path = os.environ["ICLOUD_FOLDER_PATH"].strip("/")
    ipa_path = Path(os.environ["IPA_PATH"])
    verification_code = os.environ.get("ICLOUD_2FA_CODE", "").strip()
    session_dir = Path(os.environ.get("ICLOUD_SESSION_DIR", ".icloud-session"))
    session_dir.mkdir(parents=True, exist_ok=True)

    if not ipa_path.is_file():
        raise FileNotFoundError(f"IPA non trovata: {ipa_path}")

    # pyicloud persists its cookies and session metadata in this directory.
    # GitHub Actions restores/saves this directory between runs (encrypted).
    api = PyiCloudService(username, password, cookie_directory=str(session_dir))

    if getattr(api, "requires_2fa", False):
        if not verification_code:
            raise RuntimeError(
                "Apple richiede un codice 2FA. Avvia il workflow con un codice "
                "Apple recente nel campo ICLOUD_2FA_CODE."
            )
        if not api.validate_2fa_code(verification_code):
            raise RuntimeError(
                "Il codice Apple 2FA non è stato accettato. Richiedi un codice "
                "nuovo e riprova; non riutilizzare un codice precedente."
            )
        if not api.is_trusted_session:
            api.trust_session()

    if getattr(api, "requires_2sa", False):
        raise RuntimeError(
            "L'account richiede la verifica 2SA, non gestita da questo tentativo."
        )

    folder = api.drive
    for part in [item for item in folder_path.split("/") if item]:
        folder = folder[part]

    with ipa_path.open("rb") as ipa_file:
        folder.upload(ipa_file)

    print(f"Caricamento iCloud completato: {ipa_path.name}")
    print("Sessione pyicloud pronta per essere salvata in modo cifrato da GitHub Actions.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Errore upload iCloud: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
