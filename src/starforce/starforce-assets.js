import { fileURLToPath } from 'node:url';

export const STARFORCE_DEFAULT_IMAGE_PATH =
  fileURLToPath(new URL('../../assets/starforce/default-enhancement-frame.png', import.meta.url));

export const STARFORCE_EQUIPMENT_ICON_NORMAL_PATH =
  fileURLToPath(new URL('../../assets/starforce/equipment-icon-normal.png', import.meta.url));

export const STARFORCE_EQUIPMENT_ICON_DESTROYED_PATH =
  fileURLToPath(new URL('../../assets/starforce/equipment-icon-destroyed.png', import.meta.url));
