import subprocess
import json
import os
import time

# Konfigurasi
API_KEY = "AIzaSyApqcL86EjNPUhSGkTW6w_O-Wd4BnxLz4Q"
TARGET_COMMAND = "node index.js"  # Ganti dengan perintah aplikasi kamu
MAX_RETRIES = 3  # Batas maksimal mencoba memperbaiki secara otomatis

def ask_gemini(error_message, attempt):
    print(f"\n[AIKU] (Percobaan {attempt}/{MAX_RETRIES}) Menganalisis error dengan Gemini...")
    
    prompt = (
        f"Saya menjalankan perintah '{TARGET_COMMAND}' dan muncul error berikut:\n\n"
        f"{error_message}\n\n"
        f"Berikan satu baris perintah bash murni untuk memperbaikinya. "
        f"Jangan berikan penjelasan, markdown, atau basa-basi. Cukup satu baris perintah murni saja."
    )
    
    curl_cmd = [
        "curl",
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={API_KEY}",
        "-H", "Content-Type: application/json",
        "-X", "POST",
        "-d", json.dumps({
            "contents": [{
                "parts": [{"text": prompt}]
            }]
        })
    ]
    
    try:
        result = subprocess.run(curl_cmd, capture_output=True, text=True)
        response = json.loads(result.stdout)
        suggestion = response['candidates'][0]['content']['parts'][0]['text']
        return suggestion.strip()
    except Exception as e:
        return f"Error saat memanggil API: {e}"

def run_and_validate():
    attempt = 1
    
    while attempt <= MAX_RETRIES:
        print(f"\n--- [AIKU] Menjalankan Aplikasi (Percobaan ke-{attempt}) ---")
        
        # Jalankan aplikasi utama dan pantau outputnya
        process = subprocess.Popen(
            TARGET_COMMAND,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        stdout, stderr = process.communicate()

        # === PROSES VALIDASI ===
        if process.returncode == 0:
            print("\n[AIKU] [SUKSES] Aplikasi berjalan lancar tanpa error!")
            print(f"[App Output]:\n{stdout}")
            break  # Keluar dari loop karena aplikasi sukses divalidasi
        else:
            print(f"\n[AIKU] [ERROR TERDETEKSI] Aplikasi crash dengan pesan:\n{stderr}")
            
            if attempt == MAX_RETRIES:
                print("\n[AIKU] [GAGAL] Sudah mencapai batas maksimal perbaikan otomatis. Silakan cek manual.")
                break
            
            # Hubungi Gemini untuk mencari perbaikan
            solusi = ask_gemini(stderr, attempt)
            
            # Bersihkan teks dari format markdown jika ada
            clean_cmd = solusi.replace('```bash', '').replace('```', '').strip()
            
            print(f"[AIKU] Solusi yang disarankan: {clean_cmd}")
            print("[AIKU] Mengeksekusi perbaikan otomatis...")
            
            # Eksekusi perintah perbaikan langsung di shell
            os.system(clean_cmd)
            
            # Beri jeda 2 detik sebelum masuk ke iterasi berikutnya untuk memvalidasi ulang
            time.sleep(2)
            attempt += 1

if __name__ == "__main__":
    run_and_validate()
