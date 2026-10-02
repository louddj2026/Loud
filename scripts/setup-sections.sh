#!/usr/bin/env bash
set -euo pipefail
root=/opt/crowd2-sections
python="$root/bin/python"
mode="${1:---install}"
if [[ "$mode" == "--install" ]]; then
  echo 'Installing the separate Crowd2 song-section environment.'
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl ca-certificates git build-essential ffmpeg
  mkdir -p "$root/setup"
  uv_archive="$root/setup/uv.tar.gz"
  if [[ ! -f "$uv_archive" ]] || ! echo '745765a3b6e360ad76743599ae5c42e9278c7edf8bbff9fc76d05bf2623a04dd  '"$uv_archive" | sha256sum -c - >/dev/null 2>&1; then
    curl --fail --location --proto '=https' --tlsv1.2 'https://releases.astral.sh/github/uv/releases/download/0.12.13/uv-x86_64-unknown-linux-gnu.tar.gz' -o "$uv_archive"
  fi
  echo '745765a3b6e360ad76743599ae5c42e9278c7edf8bbff9fc76d05bf2623a04dd  '"$uv_archive" | sha256sum -c -
  tar -xzf "$uv_archive" -C "$root/setup"
  uv="$root/setup/uv-x86_64-unknown-linux-gnu/uv"
  export UV_PYTHON_INSTALL_DIR=/opt/crowd2-python
  "$uv" python install 3.10.21 --no-bin
  if [[ ! -x "$python" ]]; then "$uv" venv --python 3.10.21 "$root" --allow-existing; fi
  "$uv" pip install --python "$python" --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match 'torch==2.0.1+cpu' 'torchaudio==2.0.2+cpu' 'numpy==1.23.5' 'Cython==0.29.37' 'setuptools==69.5.1' 'wheel==0.45.1'
  MAX_JOBS=2 "$uv" pip install --python "$python" --no-build-isolation 'natten @ https://files.pythonhosted.org/packages/99/de/445919ba645b36f8fc28c9d355a3944fcfc505cadef7263bad5f01b7850a/natten-0.14.6.tar.gz#sha256=7047ece081992c56f18a23cef777ff1bff0219e9711fd2b3428f45ec0f5e1f1e'
  "$uv" pip install --python "$python" --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple --index-strategy unsafe-best-match --no-build-isolation 'madmom @ git+https://github.com/CPJKU/madmom.git@27f032e8947204902c675e5e341a3faf5dc86dae' 'allin1==1.1.0' 'demucs @ git+https://github.com/facebookresearch/demucs.git@e976d93ecc3865e5757426930257e200846a520a' 'numpy==1.23.5' 'torch==2.0.1+cpu' 'torchaudio==2.0.2+cpu'
fi
if [[ ! -x "$python" ]]; then echo 'Song-section interpreter is missing.' >&2; exit 1; fi
export TORCH_HOME="$root/models/torch"
export HF_HOME="$root/models/huggingface"
export OMP_NUM_THREADS=3
if [[ "$mode" == "--install" ]]; then
  cat > "$root/run-python" <<'SH'
#!/usr/bin/env bash
export TORCH_HOME=/opt/crowd2-sections/models/torch
export HF_HOME=/opt/crowd2-sections/models/huggingface
export OMP_NUM_THREADS=3
exec /opt/crowd2-sections/bin/python "$@"
SH
  chmod +x "$root/run-python"
fi
if [[ ! -x "$root/run-python" ]]; then echo 'Song-section launcher is missing.' >&2; exit 1; fi
"$python" - <<'PY'
import json
import allin1
import torch
import natten
from demucs.pretrained import get_model
from allin1.models.loaders import load_pretrained_model
model = load_pretrained_model('harmonix-all', device='cpu')
demucs = get_model('htdemucs')
print(json.dumps({'sections': 'verified', 'torch': torch.__version__, 'model': type(model).__name__}))
PY
