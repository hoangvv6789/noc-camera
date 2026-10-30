Set WshShell = CreateObject("WScript.Shell")
' Lấy đường dẫn thư mục hiện tại
strCurrentDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)

' Chạy lệnh khởi động backend ở chế độ ẩn hoàn toàn (tham số 0)
strCommand = """" & strCurrentDir & "\backend\venv\Scripts\python.exe"" -m uvicorn app.main:app --host 0.0.0.0 --port 8687"

WshShell.CurrentDirectory = strCurrentDir & "\backend"
WshShell.Environment("PROCESS")("PYTHONIOENCODING") = "utf-8"
WshShell.Run strCommand, 0, False

' Chờ 2 giây để server khởi động rồi tự động mở trình duyệt web
WScript.Sleep 2000
WshShell.Run "http://localhost:8687"
