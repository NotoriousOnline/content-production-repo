-- Document farm-com-content-production as a valid wp_sites.tool_scope value.
-- No schema change required; existing tool_scope column already isolates site lists.

comment on column wp_sites.tool_scope is
  'content-production | weed-com-content-production | farm-com-content-production';
