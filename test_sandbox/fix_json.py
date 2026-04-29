import os

files_to_fix = [
    r"C:\Users\admin\PFE\PFE-Obstacle-Detection\kaggle\benchmark_yolov8.ipynb",
    r"C:\Users\admin\PFE\PFE-Obstacle-Detection\benchmark\yolov8.ipynb"
]

for fp in files_to_fix:
    if not os.path.exists(fp):
        print(f"Not found: {fp}")
        continue
        
    with open(fp, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Manual string replacement for the known conflict in the metadata
    bad_part = """<<<<<<< HEAD
  "kernelspec": {"language": "python", "display_name": "Python 3", "name": "python3"},
  "language_info": {"name": "python", "version": "3.10.0"},
  "kaggle": {"accelerator": "nvidiaTeslaT4", "isInternetEnabled": true, "isGpuEnabled": true}
=======
  "kernelspec": {
   "language": "python",
   "display_name": "Python 3",
   "name": "python3"
  },
  "language_info": {
   "name": "python",
   "version": "3.10.0"
  },
  "kaggle": {
   "accelerator": "nvidiaTeslaT4",
   "dataSources": [],
   "isInternetEnabled": true,
   "language": "python",
   "sourceType": "notebook",
   "isGpuEnabled": true
  }
>>>>>>> ad42c176e9a127111dc25617771927880939154f"""
    
    good_part = """  "kernelspec": {
   "language": "python",
   "display_name": "Python 3",
   "name": "python3"
  },
  "language_info": {
   "name": "python",
   "version": "3.10.0"
  },
  "kaggle": {
   "accelerator": "nvidiaTeslaT4",
   "dataSources": [],
   "isInternetEnabled": true,
   "language": "python",
   "sourceType": "notebook",
   "isGpuEnabled": true
  }"""
    
    # Check if bad_part is exactly right
    if bad_part in content:
        content = content.replace(bad_part, good_part)
        print(f"Fixed metadata conflict in {fp}")
    else:
        print(f"Exact match not found in {fp}, applying fallback line deletion")
        # Removing conflict markers if they are spread out elsewhere
        out_lines = []
        skip_mode = False
        for line in content.split('\n'):
            if line.startswith('<<<<<<< HEAD'):
                skip_mode = True
                continue
            if line.startswith('======='):
                skip_mode = False
                continue
            if line.startswith('>>>>>>>'):
                continue
            if not skip_mode:
                out_lines.append(line)
        content = '\n'.join(out_lines)

    # Let's also make sure there are no trailing merge conflicts at the end of the file.
    # Because sometimes there is a conflict at the end of the JSON array.
    
    with open(fp, 'w', encoding='utf-8') as f:
        f.write(content)
