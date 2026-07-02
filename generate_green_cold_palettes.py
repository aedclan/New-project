from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


W, H = 1600, 1000
OUT = Path(r"C:\Users\aouiaiu\Documents\New project 2\green-cold-ui-palettes.png")


def pick_font(*names):
    for name in names:
        path = Path(r"C:\Windows\Fonts") / name
        if path.exists():
            return str(path)
    return None


FONT_REGULAR = pick_font("NotoSansSC-VF.ttf", "msyh.ttc", "Deng.ttf", "simhei.ttf")
FONT_BOLD = pick_font("msyhbd.ttc", "Dengb.ttf", "NotoSansSC-VF.ttf", "simhei.ttf") or FONT_REGULAR


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)


F_TITLE = font(44, True)
F_SUB = font(22)
F_H2 = font(30, True)
F_H3 = font(21, True)
F_BODY = font(18)
F_SMALL = font(15)
F_CODE = font(16)

img = Image.new("RGB", (W, H), "#F4F5F1")
d = ImageDraw.Draw(img)


def rounded(xy, radius, fill, outline=None, width=1):
    d.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def text(x, y, value, fill="#202622", f=F_BODY):
    d.text((x, y), value, fill=fill, font=f)


def shadow_card(x0, y0, x1, y1, fill):
    for i, color in enumerate(["#D8DDD6", "#E2E6DF", "#EAEEE8"]):
        off = 7 + i * 4
        d.rounded_rectangle((x0 + off, y0 + off, x1 + off, y1 + off), radius=28, fill=color)
    rounded((x0, y0, x1, y1), 28, fill, "#D7DDD4")


def draw_browser(x, y, w, h, palette, name, subtitle):
    bg, surface, primary, primary_dark, accent, textc, muted, line = palette
    shadow_card(x, y, x + w, y + h, surface)
    rounded((x + 22, y + 22, x + w - 22, y + 64), 16, bg, line)
    for i, color in enumerate(["#C8D5CB", "#AFC2B5", "#8FA99A"]):
        d.ellipse((x + 42 + i * 24, y + 37, x + 54 + i * 24, y + 49), fill=color)
    rounded((x + 142, y + 34, x + w - 42, y + 53), 9, "#FFFFFF", "#DFE5DF")
    text(x + 158, y + 36, "family-finance.app/dashboard", "#8A958C", F_SMALL)

    rounded((x + 28, y + 84, x + 170, y + h - 28), 20, bg)
    text(x + 50, y + 110, "家庭收支", primary_dark, F_H3)
    for idx, label in enumerate(["总览", "账单", "预算", "复盘"]):
        yy = y + 152 + idx * 44
        if idx == 0:
            rounded((x + 46, yy - 8, x + 150, yy + 24), 12, primary)
            text(x + 62, yy - 4, label, "#FFFFFF", F_SMALL)
        else:
            text(x + 62, yy - 4, label, muted, F_SMALL)

    text(x + 200, y + 95, name, textc, F_H2)
    text(x + 200, y + 130, subtitle, muted, F_SMALL)
    metrics = [("本月支出", "¥13,520"), ("结余率", "25%"), ("健康分", "76")]
    for i, (label, value) in enumerate(metrics):
        mx = x + 200 + i * 146
        rounded((mx, y + 168, mx + 128, y + 242), 16, "#FFFFFF", line)
        text(mx + 16, y + 184, label, muted, F_SMALL)
        text(mx + 16, y + 208, value, textc, F_H3)

    rounded((x + 200, y + 268, x + w - 34, y + h - 42), 22, "#FFFFFF", line)
    text(x + 224, y + 292, "支出结构", textc, F_H3)
    bars = [0.82, 0.62, 0.42, 0.28, 0.2]
    labels = ["房贷", "餐饮", "孩子", "交通", "订阅"]
    for i, ratio in enumerate(bars):
        yy = y + 342 + i * 43
        text(x + 224, yy - 5, labels[i], muted, F_SMALL)
        rounded((x + 286, yy, x + w - 88, yy + 14), 7, bg)
        rounded((x + 286, yy, x + 286 + int((w - 374) * ratio), yy + 14), 7, primary if i == 0 else accent)

    rounded((x + w - 200, y + 292, x + w - 56, y + 382), 18, bg)
    text(x + w - 178, y + 314, "建议", primary_dark, F_H3)
    text(x + w - 178, y + 344, "压低固定支出", muted, F_SMALL)


schemes = [
    {
        "title": "方案 A：雾森灰绿",
        "subtitle": "偏冷、安静、专业，适合数据面板 / 家庭财务驾驶舱",
        "colors": [
            ("背景", "#F3F6F1"),
            ("卡片", "#FFFFFF"),
            ("主绿", "#6F8F7A"),
            ("深绿", "#2F4A3D"),
            ("辅助", "#A9B8AA"),
            ("文字", "#1F2722"),
            ("弱文", "#7A857C"),
            ("线条", "#DDE5DC"),
        ],
        "palette": ("#F3F6F1", "#FAFBF8", "#6F8F7A", "#2F4A3D", "#A9B8AA", "#1F2722", "#7A857C", "#DDE5DC"),
    },
    {
        "title": "方案 B：茶白橄榄绿",
        "subtitle": "偏暖、克制、有生活感，适合记账 / 家庭规划 / 订阅管理",
        "colors": [
            ("背景", "#F7F6EF"),
            ("卡片", "#FEFCF7"),
            ("主绿", "#7D8F66"),
            ("深绿", "#384432"),
            ("辅助", "#B9BBA2"),
            ("文字", "#252820"),
            ("弱文", "#7D806F"),
            ("线条", "#E3E1D5"),
        ],
        "palette": ("#F7F6EF", "#FEFCF7", "#7D8F66", "#384432", "#B9BBA2", "#252820", "#7D806F", "#E3E1D5"),
    },
]

text(80, 58, "绿色主调 · 冷淡风网页前端配色方案", "#1F2722", F_TITLE)
text(82, 112, "低饱和绿色 + 大面积中性色 + 少量深色文字，适合家庭账本、财务面板、效率工具后台。", "#6D786F", F_SUB)

for x, scheme in [(70, schemes[0]), (830, schemes[1])]:
    top_y, card_w, card_h = 170, 700, 760
    rounded((x, top_y, x + card_w, top_y + card_h), 30, "#FFFFFF", "#D9DDD6")
    text(x + 34, top_y + 28, scheme["title"], "#1F2722", F_H2)
    text(x + 34, top_y + 67, scheme["subtitle"], "#6E786F", F_BODY)
    draw_browser(x + 34, top_y + 112, card_w - 68, 390, scheme["palette"], scheme["title"].split("：")[1], "本月收支 / 风险 / 下月准备金")

    sw_y = top_y + 540
    text(x + 34, sw_y - 34, "色板与用途", "#1F2722", F_H3)
    for i, (label, hex_value) in enumerate(scheme["colors"]):
        col = i % 4
        row = i // 4
        sx = x + 34 + col * 160
        sy = sw_y + row * 78
        rounded((sx, sy, sx + 132, sy + 48), 12, hex_value, "#D8DDD5")
        dark_colors = {"#6F8F7A", "#2F4A3D", "#7D8F66", "#384432", "#252820", "#1F2722"}
        label_color = "#FFFFFF" if hex_value in dark_colors else "#253026"
        text(sx + 12, sy + 8, label, label_color, F_SMALL)
        text(sx + 12, sy + 27, hex_value, label_color, F_CODE)

    py = top_y + 705
    rounded((x + 34, py, x + card_w - 34, py + 36), 14, scheme["palette"][0])
    text(x + 52, py + 8, "原则：背景 70% / 卡片 20% / 主绿点缀 10%，避免高饱和和强渐变。", "#59665E", F_SMALL)

text(80, 955, "使用建议：按钮、选中态、健康分用主绿；大面积背景用近白灰绿；危险提醒不要用亮红，可用低饱和砖红或深琥珀。", "#6C746C", F_SMALL)

img.save(OUT, quality=95)
print(OUT)
