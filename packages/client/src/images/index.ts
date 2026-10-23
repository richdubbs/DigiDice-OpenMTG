/**
 * Public surface of the image manager (work package C2): the screen, the Scryfall images switch (for the Settings screen too), the setting's single
 * source of truth (connect the page-wide settings store with `connectScryfallSetting`), and the image sources the card component reads.
 */
export { ImagesScreen } from './ImagesScreen';
export { ScryfallImagesSetting } from './ScryfallImagesSetting';
export { CardImagesProvider, createCardImages, defaultCardImages, useCardImages, type CardImages } from './context';
export {
  connectScryfallSetting,
  getShowScryfallImages,
  setShowScryfallImages,
  useShowScryfallImages,
  SETTINGS_KEY,
  SHOW_SCRYFALL_FIELD,
  type ScryfallSettingSource,
} from './settings';
export { idbImageStore, IMAGE_DB_NAME, type ImageStore, type StoredImage, type StoreListener } from './store';
