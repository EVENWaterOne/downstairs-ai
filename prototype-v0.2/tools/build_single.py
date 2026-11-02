#!/usr/bin/env python3
"""把 prototype-v0.2/ 打包成一个自包含的 HTML 文件（CSS、JS 全部内联）。照搬 V0.1 的 prototype/tools/build_single.py。

    python3 prototype-v0.2/tools/build_single.py out.html            # 普通单文件，可直接双击打开
    python3 prototype-v0.2/tools/build_single.py out.html --artifact # 发布到 claude.ai 网页用（去掉 doctype/head/body 外壳）
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

def main():
    out = pathlib.Path(sys.argv[1])
    artifact = "--artifact" in sys.argv
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="styles.css" />', "<style>\n" + css + "\n</style>")

    def inline(m):
        js = (ROOT / m.group(1)).read_text(encoding="utf-8").replace("</script", "<\\/script")
        return "<script>\n" + js + "\n</script>"
    html = re.sub(r'<script src="([^"]+)"></script>', inline, html)

    if artifact:
        # 外壳由 claude.ai 加；留下标题、meta、字体链接和样式
        head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
        keep = [m.group(0) for m in re.finditer(r'<title>.*?</title>|<meta name="claude:[^>]*>|<link rel="stylesheet" href="https://fonts[^>]*>|<style>.*?</style>', head, re.S)]
        body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
        html = "\n".join(keep) + "\n" + body
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")

if __name__ == "__main__":
    main()
