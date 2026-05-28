import { CATEGORIES as LOCAL_CATEGORIES, CATEGORY_EMOJI as LOCAL_EMOJI } from './local-config.mjs';

const DEFAULT_CATEGORIES = [
  'קניות לבית',
  'מסעדות',
  'תחבורה',
  'בריאות',
  'ביגוד',
  'בידור',
  'חשבונות',
  'חינוך',
  'חוגים',
  'נסיעות',
  'קניות אונליין',
  'פייבוקס/ביט',
  'הלוואות',
  'תרומות',
  'חסכונות',
  'אחר',
];

export const CATEGORIES = LOCAL_CATEGORIES ?? DEFAULT_CATEGORIES;

const DEFAULT_CATEGORY_EMOJI = {
  'קניות לבית':   '🛒',
  'מסעדות':       '🍽️',
  'תחבורה':       '🚗',
  'בריאות':       '💊',
  'ביגוד':        '👕',
  'בידור':        '🎬',
  'חשבונות':      '📄',
  'חינוך':        '🏫',
  'חוגים':        '🎯',
  'נסיעות':       '✈️',
  'קניות אונליין': '🛍️',
  'פייבוקס/ביט':  '💸',
  'הלוואות':      '🏦',
  'תרומות':       '🤲',
  'חסכונות':       '💰',
  'אחר':          '📦',
};

export const CATEGORY_EMOJI = LOCAL_EMOJI ?? DEFAULT_CATEGORY_EMOJI;
