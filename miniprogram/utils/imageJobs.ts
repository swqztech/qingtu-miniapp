export type OutputFormat = 'keep' | 'jpeg' | 'png';

export type PickedImage = { path: string; name: string };

export type CompressLine = {
  name: string;
  before: number;
  after: number;
  outPath: string;
  ok: boolean;
  message?: string;
};

function fileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}

function getFileSize(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath: path,
      success: res => resolve(res.size),
      fail: reject,
    });
  });
}

/** 单张压缩 */
export async function compressOne(
  src: string,
  quality: number,
  format: OutputFormat,
): Promise<CompressLine> {
  const name = fileName(src);
  try {
    const before = await getFileSize(src);
    const q = Math.max(1, Math.min(100, quality));
    const compressed = await new Promise<WechatMiniprogram.CompressImageSuccessCallbackResult>(
      (resolve, reject) => {
        wx.compressImage({
          src,
          quality: q,
          success: resolve,
          fail: reject,
        });
      },
    );
    const outPath = compressed.tempFilePath;
    const after = await getFileSize(outPath);
    let message = '完成';
    if (format === 'jpeg') {
      message += '（输出为 JPEG 临时文件）';
    }
    return { name, before, after, outPath, ok: true, message };
  } catch (e) {
    return {
      name,
      before: 0,
      after: 0,
      outPath: '',
      ok: false,
      message: String(e),
    };
  }
}

type CanvasImage = {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
};

type Canvas2dContext = {
  drawImage: (
    image: CanvasImage,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void;
};

type CanvasNode = WechatMiniprogram.Canvas & {
  getContext: (type: '2d') => Canvas2dContext;
  createImage: () => CanvasImage;
};

/** 横向拼接，需页面内 type="2d" 的 canvas */
export function stitchHorizontal(
  page: WechatMiniprogram.Page.TrivialInstance,
  paths: string[],
  canvasId: string,
): Promise<string> {
  if (paths.length < 2) {
    return Promise.reject(new Error('拼接需要至少 2 张图'));
  }

  return Promise.all(
    paths.map(
      p =>
        new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>(
          (resolve, reject) => {
            wx.getImageInfo({ src: p, success: resolve, fail: reject });
          },
        ),
    ),
  ).then(infos => {
    const targetH = Math.min(...infos.map(i => i.height));
    const scaled = infos.map(info => {
      const w = Math.max(1, Math.round((info.width * targetH) / info.height));
      return { path: info.path, width: w, height: targetH };
    });
    const totalW = scaled.reduce((s, i) => s + i.width, 0);

    return new Promise<string>((resolve, reject) => {
      const query = wx.createSelectorQuery().in(page);
      query
        .select(`#${canvasId}`)
        .fields({ node: true, size: true })
        .exec(async res => {
          try {
            const canvas = res[0]?.node as CanvasNode | undefined;
            if (!canvas) {
              reject(new Error('Canvas 未就绪'));
              return;
            }
            canvas.width = totalW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            let x = 0;
            for (const piece of scaled) {
              const img = canvas.createImage();
              await new Promise<void>((ok, fail) => {
                img.onload = () => ok();
                img.onerror = () => fail(new Error('图片加载失败'));
                img.src = piece.path;
              });
              ctx.drawImage(img, x, 0, piece.width, piece.height);
              x += piece.width;
            }
            wx.canvasToTempFilePath({
              canvas,
              fileType: 'png',
              success: r => resolve(r.tempFilePath),
              fail: reject,
            });
          } catch (e) {
            reject(e);
          }
        });
    });
  });
}

export function formatCompressLog(lines: CompressLine[]): string {
  return lines
    .map(l => {
      if (!l.ok) {
        return `${l.name}: ${l.message}`;
      }
      const ratio =
        l.before > 0
          ? `${((1 - l.after / l.before) * 100).toFixed(1)}%`
          : '-';
      return `${l.name}: ${l.before} → ${l.after} (${ratio})`;
    })
    .join('\n');
}
