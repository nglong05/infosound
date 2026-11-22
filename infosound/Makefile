SHELL := /bin/bash
.PHONY: doctor bootstrap build up status logs backup restore-test down
doctor:
	bash scripts/doctor.sh
bootstrap:
	[ -f .env ] || cp .env.example .env
	set -a; . ./.env; set +a; python3 scripts/init-secrets.py; python3 scripts/render-config.py
build:
	bash scripts/build.sh
up:
	bash scripts/up.sh
status:
	bash scripts/compose.sh ps
logs:
	python3 scripts/safe-logs.py
backup:
	bash scripts/backup.sh
restore-test:
	bash scripts/restore-test.sh
down:
	bash scripts/compose.sh down
