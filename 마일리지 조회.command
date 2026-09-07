#!/bin/zsh
cd -- "${0:A:h}" || exit 1
exec python3 local_app.py --open
