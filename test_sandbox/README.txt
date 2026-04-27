Dossier d'essais — le code de prod (api/, PFE-Mobile-App/, etc.) n'est pas modifié ici.

Depuis la racine du repo (PFE-Obstacle-Detection) :

  pip install -r test_sandbox/requirements-smoke.txt

  python test_sandbox/import_check.py        # vérifie pfe + api.vision_pipeline
  python test_sandbox/predict_api_smoke.py   # POST /predict (API déjà lancée)

Si vous êtes déjà dans le dossier test_sandbox (invite ...\test_sandbox>), n'ajoutez pas
test_sandbox/ devant le nom du script (sinon Python cherche test_sandbox\test_sandbox\...) :

  python import_check.py
  python predict_api_smoke.py

Si connexion refusée sur 127.0.0.1:8787 : démarrer l'API avant (autre terminal) :
  cd api
  python inference_server.py

Variables utiles :
  API_BASE     URL de base (défaut http://127.0.0.1:8787)
  REQUIRE_API  si 1 : predict_api_smoke échoue (code 1) si l'API n'est pas joignable
