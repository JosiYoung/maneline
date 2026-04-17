-- SEED DATA ONLY — replace with official Silver Lining Protocols before Phase 4 launch.
-- These placeholder rows exist so Phase 4 (chatbot) has content to index during development.
-- Do NOT commercialize or publish this data.

INSERT INTO public.protocols (number, name, description, use_case, associated_sku_placeholder)
VALUES
  ('#10', 'Joint Support',       'Joint health for performance horses',  'Supports mobility and joint integrity in active performance horses',    'placeholder'),
  ('#17', 'Colic Eaz',           'Digestive emergency support',          'Immediate digestive comfort during colic episodes',                     'placeholder'),
  ('#33', 'Calming Care',        'Behavior / calm for show nerves',      'Reduces anxiety and promotes focus for show and transport',              'placeholder'),
  (NULL,  'Mare Moods',          'Hormone support for mares',            'Balances hormonal cycles to improve temperament and comfort',            'placeholder'),
  (NULL,  'Bug Control Bundle',  'Seasonal fly + pest defense',          'Seasonal protection against flies, ticks, and common pests',             'placeholder')
ON CONFLICT DO NOTHING;
