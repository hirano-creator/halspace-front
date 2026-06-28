from PIL import Image, ImageDraw, ImageFont
import os

FONTS = [
    'C:/Windows/Fonts/seguibl.ttf',
    'C:/Windows/Fonts/segoeuib.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/calibrib.ttf',
]

def get_font(size):
    for path in FONTS:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)

def create_icon(size):
    img = Image.new('RGB', (size, size), color=(10, 10, 10))
    draw = ImageDraw.Draw(img)

    font_size = round(size * 0.488)
    font = get_font(font_size)

    # letter-spacing: -18 at 512px（比例スケール）
    spacing = size * (-18 / 512)

    chars = [
        ('a', (255, 255, 255)),
        ('.', (31, 72, 255)),
        ('a', (255, 255, 255)),
    ]

    # anchor='la'（デフォルト）で各文字の描画位置とbboxを計測
    # 文字はすべて同じ y=0（アセンダーライン）から描画 → ベースライン揃い
    x = 0.0
    positions = []
    bboxes = []
    for ch, color in chars:
        bb = draw.textbbox((x, 0), ch, font=font)  # anchor='la' がデフォルト
        positions.append((x, color, ch))
        bboxes.append(bb)
        x += font.getlength(ch) + spacing

    # 全体の視覚バウンディングボックス
    left   = min(bb[0] for bb in bboxes)
    top    = min(bb[1] for bb in bboxes)
    right  = max(bb[2] for bb in bboxes)
    bottom = max(bb[3] for bb in bboxes)

    # 画像中央に揃えるオフセット
    ox = (size - (right - left)) / 2 - left
    oy = (size - (bottom - top)) / 2 - top

    # 描画（anchor='la' をデフォルトで使用 → 計測と一致）
    for (draw_x, color, ch) in positions:
        draw.text((draw_x + ox, oy), ch, fill=color, font=font)  # anchor='la'

    return img

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')

for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png')]:
    img = create_icon(size)
    path = os.path.join(out_dir, name)
    img.save(path, 'PNG', optimize=True)
    print(f'{name}: {os.path.getsize(path)} bytes')

print('Done.')
