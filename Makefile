.PHONY: install dev bot-poll migrate test content-check assets android-debug android-aab

install:
	cd client && npm ci
	uv sync --project server --group dev --locked

dev:
	bash scripts/dev.sh

bot-poll:
	cd server && uv run --locked python -m app.services.telegram_polling

migrate:
	uv run --project server --locked alembic -c server/alembic.ini upgrade head

test:
	cd server && uv run --locked ruff check --no-respect-gitignore app tests migrations ../tools
	cd server && uv run --locked mypy app ../tools/assets
	cd server && uv run --locked pytest tests
	cd client && npm run lint && npm run test && npm run build

content-check:
	cd client && npm run content-check

# Rebuild original sprites, atlas, SFX and music into client/public/assets (needs ffmpeg).
assets:
	python3 tools/assets/build_assets.py

# --- Android (Capacitor) ---------------------------------------------------------------
# Needs JDK 21 in JAVA_HOME and the Android SDK in ANDROID_HOME (README, section Android).

# Debug APK on a USB-connected phone; the phone reaches `make dev` through adb reverse.
android-debug:
	cd client && VITE_API_URL=http://localhost:8000 npm run build && npx cap sync android
	cd client/android && ./gradlew --quiet assembleDebug
	adb reverse tcp:8000 tcp:8000
	adb install -r client/android/app/build/outputs/apk/debug/app-debug.apk
	adb shell am start -n com.wasteland.game/.MainActivity

# Signed release bundle for Google Play in one command:
#   ANDROID_PUBLIC_URL=https://game.example.com WASTELAND_KEYSTORE=... make android-aab
android-aab:
	@case "$(ANDROID_PUBLIC_URL)" in https://*) ;; \
	  *) echo "Set ANDROID_PUBLIC_URL=https://<game domain> (the server PUBLIC_URL)" >&2; exit 1;; esac
	cd client && VITE_API_URL=$(ANDROID_PUBLIC_URL) npm run build && npx cap sync android
	cd client/android && \
	  WASTELAND_APP_LINK_HOST=$$(echo "$(ANDROID_PUBLIC_URL)" | sed -E 's#^https://([^/:]+).*#\1#') \
	  ./gradlew --quiet bundleRelease
	@echo "AAB: client/android/app/build/outputs/bundle/release/app-release.aab"
