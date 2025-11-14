
#!/bin/bash
set -e
TS=$(date +"%Y%m%d-%H%M%S")
mkdir -p backups
cp -r data "backups/data-$TS"
echo "Backup created: backups/data-$TS"
