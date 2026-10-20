import {
  compressOne,
  formatCompressLog,
  stitchHorizontal,
  type CompressLine,
  type OutputFormat,
  type PickedImage,
} from '../../utils/imageJobs';

const CANVAS_ID = 'stitchCanvas';

function runLabel(compressTab: boolean, count: number): string {
  return compressTab ? `开始压缩 (${count})` : `开始拼接 (${count})`;
}

Page({
  data: {
    compressTab: true,
    busy: false,
    files: [] as PickedImage[],
    quality: 80,
    format: 'keep' as OutputFormat,
    log: '',
    runLabel: runLabel(true, 0),
  },

  onTabCompress() {
    if (this.data.busy) return;
    this.setData({
      compressTab: true,
      runLabel: runLabel(true, this.data.files.length),
    });
  },

  onTabStitch() {
    if (this.data.busy) return;
    this.setData({
      compressTab: false,
      runLabel: runLabel(false, this.data.files.length),
    });
  },

  onPickImages() {
    if (this.data.busy) return;
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original', 'compressed'],
      success: res => {
        const base = this.data.files.length;
        const added: PickedImage[] = res.tempFiles.map((f, i) => ({
          path: f.tempFilePath,
          name: `图片 ${base + i + 1}`,
        }));
        const files = [...this.data.files, ...added];
        this.setData({
          files,
          runLabel: runLabel(this.data.compressTab, files.length),
        });
      },
    });
  },

  onQualityMinus() {
    if (this.data.busy) return;
    this.setData({ quality: Math.max(1, this.data.quality - 5) });
  },

  onQualityPlus() {
    if (this.data.busy) return;
    this.setData({ quality: Math.min(100, this.data.quality + 5) });
  },

  onFormatTap(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const format = e.currentTarget.dataset.format as OutputFormat;
    if (format) {
      this.setData({ format });
    }
  },

  async saveToAlbum(path: string) {
    try {
      await new Promise<void>((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath: path, success: () => resolve(), fail: reject });
      });
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch {
      wx.showModal({
        title: '轻图',
        content: '保存失败，请检查相册权限。',
        showCancel: false,
      });
    }
  },

  async onRunJob() {
    if (this.data.busy) return;
    const { compressTab, files, quality, format } = this.data;
    if (!files.length) {
      this.setData({ log: '请先添加图片' });
      return;
    }

    this.setData({ busy: true });
    try {
      if (compressTab) {
        const lines: CompressLine[] = [];
        for (const f of files) {
          lines.push(await compressOne(f.path, quality, format));
        }
        this.setData({ log: formatCompressLog(lines) });
        const last = lines.find(l => l.ok && l.outPath);
        if (last) {
          await this.saveToAlbum(last.outPath);
        }
      } else {
        if (files.length < 2) {
          this.setData({ log: '拼接需要至少 2 张图' });
          return;
        }
        const out = await stitchHorizontal(
          this as WechatMiniprogram.Page.TrivialInstance,
          files.map(f => f.path),
          CANVAS_ID,
        );
        this.setData({ log: `拼接完成\n${out}` });
        await this.saveToAlbum(out);
      }
    } catch (e) {
      this.setData({ log: String(e) });
    } finally {
      this.setData({ busy: false });
    }
  },

  onClear() {
    if (this.data.busy) return;
    this.setData({
      files: [],
      log: '',
      runLabel: runLabel(this.data.compressTab, 0),
    });
  },
});
