-- Modelo manual para criar um produto pelo SQL Editor do Supabase.
-- Altere somente os três valores da seção "dados".
-- O sistema já faz este processo automaticamente pelo botão "+ Criar produto".

do $$
declare
  p_name text := 'NOVO PRODUTO';
  p_slug text := 'novo-produto';
  p_template_name text := 'Implantação padrão';
  v_product_id uuid;
  v_template_id uuid;
  v_version_id uuid;
  v_phase_id uuid;
begin
  if exists (
    select 1 from implementacao.products
    where lower(name) = lower(p_name) or slug = p_slug
  ) then
    raise exception 'Já existe um produto com este nome ou identificador.';
  end if;

  insert into implementacao.products (name, slug, active)
  values (p_name, p_slug, true)
  returning id into v_product_id;

  insert into implementacao.implementation_templates (product_id, name)
  values (v_product_id, p_template_name)
  returning id into v_template_id;

  insert into implementacao.implementation_template_versions
    (template_id, version, status, definition, published_at)
  values (
    v_template_id,
    1,
    'PUBLISHED'::implementacao."TemplateVersionStatus",
    jsonb_build_object(
      'phases', jsonb_build_array(jsonb_build_object(
        'code', 'F01',
        'name', 'Configuração inicial',
        'order', 1,
        'isBase', true,
        'durationWeeks', 1,
        'meetingsPerWeek', 1,
        'questions', '[]'::jsonb
      ))
    ),
    now()
  )
  returning id into v_version_id;

  insert into implementacao.template_phases
    (template_version_id, code, name, sort_order)
  values (v_version_id, 'F01', 'Configuração inicial', 1)
  returning id into v_phase_id;

  raise notice 'Produto criado: %, versão: %, fase: %', v_product_id, v_version_id, v_phase_id;
end $$;
