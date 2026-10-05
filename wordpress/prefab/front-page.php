<?php
/**
 * Magazine homepage for prefab.com.
 *
 * Latest 3 posts fill the feature grid, the latest 5 fill the sidebar,
 * and the main list continues after those five.
 */

if (!defined('ABSPATH')) {
    exit;
}

get_header();

$prefab_home_paged = max(1, (int) get_query_var('paged'), (int) get_query_var('page'));

$prefab_home_latest = get_posts([
    'post_type'           => 'post',
    'post_status'         => 'publish',
    'posts_per_page'      => 5,
    'orderby'             => 'date',
    'order'               => 'DESC',
    'ignore_sticky_posts' => true,
    'no_found_rows'       => true,
    'suppress_filters'    => false,
]);

$prefab_home_featured = array_slice($prefab_home_latest, 0, 3);
$prefab_home_skip_ids = array_map('intval', wp_list_pluck($prefab_home_latest, 'ID'));

$prefab_home_list = new WP_Query([
    'post_type'           => 'post',
    'post_status'         => 'publish',
    'posts_per_page'      => 9,
    'paged'               => $prefab_home_paged,
    'post__not_in'        => $prefab_home_skip_ids,
    'orderby'             => 'date',
    'order'               => 'DESC',
    'ignore_sticky_posts' => true,
]);

if (!function_exists('prefab_home_category_name')) {
    function prefab_home_category_name() {
        $categories = get_the_category();
        if (empty($categories) || !isset($categories[0]->name)) {
            return '';
        }
        return $categories[0]->name;
    }
}

if (!function_exists('prefab_home_excerpt')) {
    function prefab_home_excerpt() {
        return wp_trim_words(wp_strip_all_tags(get_the_excerpt()), 22, '...');
    }
}

if (!function_exists('prefab_home_image')) {
    function prefab_home_image($post_id, $size) {
        $attachment_id = get_post_thumbnail_id($post_id);
        if (!$attachment_id) {
            return '';
        }
        $src = wp_get_attachment_image_url($attachment_id, $size);
        if (!$src) {
            return '';
        }
        $alt = (string) get_post_meta($attachment_id, '_wp_attachment_image_alt', true);
        if ($alt === '') {
            $alt = get_the_title($post_id);
        }
        return '<img class="wp-post-image" src="' . esc_url($src) . '" alt="' . esc_attr($alt) . '" />';
    }
}
?>
<style>
  .home .breadcrumbs { display: none; }

  * { box-sizing: border-box; }

  .no-sidebar .front-main,
  .front-main { width: 100% !important; }

  .ts-row { padding: 0 var(--wrap-padding); }

  .full-width-row {
    max-width: 100% !important;
    width: 100% !important;
    padding: 0 20px;
  }

  .full-width-content {
    width: 100% !important;
    max-width: 100% !important;
  }

  .featured-section { margin-bottom: 60px; }

  .featured-section .posts-grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    grid-template-rows: repeat(2, 1fr);
    gap: 6px;
  }

  .featured-section .post-item {
    position: relative;
    overflow: hidden;
  }

  .featured-section .post-item:nth-child(1) {
    grid-column: 1/2;
    grid-row: 1/3;
    height: 480px;
  }

  .featured-section .post-item:nth-child(2),
  .featured-section .post-item:nth-child(3) {
    grid-column: 2/3;
    height: 237px;
  }

  .featured-section .post-link {
    position: absolute;
    inset: 0;
    z-index: 100;
  }

  .featured-section .post-thumbnail {
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
    background: #222;
  }

  .featured-section .post-thumbnail img,
  .featured-section .post-thumbnail .img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.5s ease;
  }

  .featured-section .post-item:hover .post-thumbnail img,
  .featured-section .post-item:hover .post-thumbnail .img {
    transform: scale(1.05);
  }

  .featured-section .post-thumbnail:before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0) 60%);
    opacity: 0.8;
    transition: opacity 0.5s ease;
    pointer-events: none;
    z-index: 1;
  }

  .featured-section .post-item:hover .post-thumbnail:before { opacity: 1; }

  .featured-section .post-content {
    position: absolute;
    inset: 0;
    padding: 20px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    z-index: 2;
  }

  .featured-section .post-category {
    display: inline-block;
    width: fit-content;
    background-color: var(--c-main, #1b4d2e);
    color: #fff;
    padding: 6px 10px;
    border-radius: 3px;
    font-size: 14px;
    line-height: 1.2;
    text-transform: uppercase;
  }

  .featured-section h3.post-title {
    margin: 12px 0 10px !important;
    font-size: 18px !important;
    font-weight: 700 !important;
    line-height: 1.25 !important;
    color: #fff !important;
  }

  .featured-section .author-block {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    color: #fff;
  }

  .posts-list .post-item {
    display: flex;
    align-items: center;
    margin-bottom: 20px;
  }

  .posts-list .post-thumbnail {
    flex: 2;
    margin-right: 20px;
  }

  .posts-list .post-thumbnail img,
  .posts-list .post-thumbnail .img {
    width: 100%;
    height: auto;
    max-height: 170px;
    object-fit: cover;
    display: block;
  }

  .posts-list .post-content { flex: 4; }

  .posts-list .post-category {
    font-size: 14px;
    font-weight: 500;
    text-transform: uppercase;
    color: var(--c-main, #1b4d2e);
    display: block;
    margin: 0 0 4px;
  }

  .posts-list .post-title {
    font-size: 20px;
    line-height: 1.25;
    margin: 0 0 6px;
  }

  .posts-list .post-title a {
    color: var(--c-headings, #1b4d2e);
    text-decoration: none;
  }

  .posts-list .post-title a:hover { color: var(--c-main, #1b4d2e); }

  .posts-list .post-author,
  .posts-list .post-date {
    font-size: 12px;
    color: #7f8c8d;
  }

  .posts-list .post-excerpt {
    margin: 6px 0 0;
    font-size: 14px;
    color: #505050;
  }

  .posts-list hr {
    border: none;
    border-top: 1px solid #e0e0e0;
    margin: 20px 0;
  }

  .home-content-layout {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
    gap: 42px;
    align-items: start;
  }

  .home-main-column,
  .home-sidebar { min-width: 0; }

  .home-sidebar .sidebar-title {
    display: flex;
    align-items: center;
    gap: 18px;
    margin: 0 0 28px;
    font-size: 22px;
    line-height: 1.2;
    font-weight: 700;
    color: var(--c-headings, #1b4d2e);
    text-transform: lowercase;
  }

  .home-sidebar .sidebar-title:after {
    content: "";
    flex: 1;
    height: 1px;
    background: #d9d9d9;
  }

  .home-sidebar .latest-sidebar-item {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 0 0 16px;
    margin: 0 0 16px;
    border-bottom: 1px solid #e5e5e5;
  }

  .home-sidebar .latest-sidebar-item:last-child { margin-bottom: 0; }

  .home-sidebar .latest-sidebar-thumb {
    flex: 0 0 112px;
    width: 112px;
  }

  .home-sidebar .latest-sidebar-thumb a,
  .posts-list .post-thumbnail a { display: block; }

  .home-sidebar .latest-sidebar-thumb img,
  .home-sidebar .latest-sidebar-thumb .img {
    display: block;
    width: 112px;
    height: 78px;
    object-fit: cover;
  }

  .home-sidebar .latest-sidebar-content {
    flex: 1 1 auto;
    min-width: 0;
  }

  .home-sidebar .latest-sidebar-title {
    margin: 0 0 8px;
    font-size: 17px;
    line-height: 1.25;
    font-weight: 700;
  }

  .home-sidebar .latest-sidebar-title a {
    color: var(--c-headings, #1b4d2e);
    text-decoration: none;
  }

  .home-sidebar .latest-sidebar-title a:hover { color: var(--c-main, #1b4d2e); }

  .home-sidebar .latest-sidebar-date {
    display: block;
    font-size: 12px;
    line-height: 1.25;
    color: #8a8a8a;
  }

  .home-pagination {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin: 30px 0 40px;
  }

  .home-pagination .page-numbers {
    display: inline-block;
    padding: 8px 12px;
    border: 1px solid #ddd;
    background: #fff;
    color: #505050;
    text-decoration: none;
  }

  .home-pagination a.page-numbers:hover,
  .home-pagination .page-numbers.current {
    background: var(--c-main, #1b4d2e);
    border-color: var(--c-main, #1b4d2e);
    color: #fff;
  }

  .home-pagination .page-numbers.dots {
    border: none;
    background: transparent;
  }

  @media (max-width: 900px) {
    .home-content-layout {
      grid-template-columns: 1fr;
      gap: 36px;
    }
  }

  @media (max-width: 768px) {
    .featured-section { margin-bottom: 30px; }

    .featured-section .posts-grid {
      grid-template-columns: 1fr 1fr;
      grid-template-rows: auto;
    }

    .featured-section .post-item:nth-child(1) {
      grid-column: 1/3;
      grid-row: auto;
      height: 285px;
    }

    .featured-section .post-item:nth-child(2),
    .featured-section .post-item:nth-child(3) {
      grid-column: span 1;
      height: 240px;
    }

    .featured-section .post-content { padding: 8px; }
    .featured-section .post-category { font-size: 11px; padding: 3px 5px; }
    .featured-section h3.post-title { font-size: 15px !important; margin: 8px 0 6px !important; }
    .featured-section .author-block { font-size: 11px; }

    .full-width-row { padding: 0 14px; }

    .posts-list .post-item {
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 18px;
    }

    .posts-list .post-thumbnail {
      flex: 0 0 38%;
      width: 38%;
      margin: 0;
    }

    .posts-list .post-thumbnail img,
    .posts-list .post-thumbnail .img {
      height: 120px;
      max-height: none;
    }

    .posts-list .post-content { flex: 1 1 auto; min-width: 0; }
    .posts-list .post-category { font-size: 11px; line-height: 1.2; margin-bottom: 4px; }
    .posts-list .post-title { font-size: 16px; line-height: 1.2; margin: 0 0 5px; }
    .posts-list .post-author,
    .posts-list .post-date { font-size: 11px; line-height: 1.25; }
    .posts-list .post-excerpt {
      margin-top: 5px;
      font-size: 12px;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  }

  @media (max-width: 480px) {
    .posts-list .post-thumbnail { flex-basis: 40%; width: 40%; }
    .posts-list .post-thumbnail img,
    .posts-list .post-thumbnail .img { height: 105px; }
    .posts-list .post-title { font-size: 15px; }
    .home-sidebar .latest-sidebar-thumb { flex-basis: 105px; width: 105px; }
    .home-sidebar .latest-sidebar-thumb img,
    .home-sidebar .latest-sidebar-thumb .img { width: 105px; height: 74px; }
    .home-sidebar .latest-sidebar-title { font-size: 16px; }
  }
</style>

<div class="main ts-contain cf right-sidebar">
<?php if ($prefab_home_featured) : ?>
  <div class="featured-section">
    <div class="posts-grid">
      <?php
      foreach ($prefab_home_featured as $prefab_home_post) :
          setup_postdata($prefab_home_post);
          $prefab_home_title = get_the_title($prefab_home_post);
          $prefab_home_category = prefab_home_category_name();
          ?>
          <div class="post-item">
            <a class="post-link" href="<?php echo esc_url(get_permalink($prefab_home_post)); ?>" aria-label="<?php echo esc_attr($prefab_home_title); ?>"></a>
            <div class="post-thumbnail">
              <?php echo prefab_home_image($prefab_home_post->ID, 'large'); ?>
            </div>
            <div class="post-content">
              <?php if ($prefab_home_category !== '') : ?>
                <span class="post-category"><?php echo esc_html($prefab_home_category); ?></span>
              <?php endif; ?>
              <h3 class="post-title"><?php echo esc_html($prefab_home_title); ?></h3>
              <div class="author-block">
                <span class="post-author">By <?php echo esc_html(get_the_author_meta('display_name', $prefab_home_post->post_author)); ?></span>
                -
                <span class="post-date"><?php echo esc_html(get_the_date('F j, Y', $prefab_home_post)); ?></span>
              </div>
            </div>
          </div>
      <?php endforeach; ?>
      <?php wp_reset_postdata(); ?>
    </div>
  </div>
<?php endif; ?>

  <div class="ts-row full-width-row">
    <div class="front-main full-width-content">
      <div class="home-content-layout">
        <main class="home-main-column">
          <div class="posts-list">
            <?php
            if ($prefab_home_list->have_posts()) :
                $prefab_home_index = 0;
                $prefab_home_total = (int) $prefab_home_list->post_count;
                while ($prefab_home_list->have_posts()) :
                    $prefab_home_list->the_post();
                    $prefab_home_index++;
                    $prefab_home_category = prefab_home_category_name();
                    ?>
                    <div class="post-item">
                      <div class="post-thumbnail">
                        <a href="<?php the_permalink(); ?>">
                          <?php the_post_thumbnail('medium_large', ['alt' => get_the_title()]); ?>
                        </a>
                      </div>
                      <div class="post-content">
                        <?php if ($prefab_home_category !== '') : ?>
                          <span class="post-category"><?php echo esc_html($prefab_home_category); ?></span>
                        <?php endif; ?>
                        <h3 class="post-title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h3>
                        <span class="post-author">By <?php the_author(); ?></span>
                        -
                        <span class="post-date"><?php echo esc_html(get_the_date('F j, Y')); ?></span>
                        <div class="post-excerpt"><?php echo esc_html(prefab_home_excerpt()); ?></div>
                      </div>
                    </div>
                    <?php if ($prefab_home_index < $prefab_home_total) : ?>
                      <hr>
                    <?php endif; ?>
                <?php endwhile; ?>
                <?php wp_reset_postdata(); ?>
            <?php endif; ?>
          </div>

          <?php
          $prefab_home_links = paginate_links([
              'total'     => max(1, (int) $prefab_home_list->max_num_pages),
              'current'   => $prefab_home_paged,
              'mid_size'  => 1,
              'end_size'  => 1,
              'prev_text' => 'Previous',
              'next_text' => 'Next',
          ]);
          if ($prefab_home_links) :
              ?>
              <nav class="home-pagination" aria-label="Posts"><?php echo wp_kses_post($prefab_home_links); ?></nav>
          <?php endif; ?>
        </main>

        <aside class="home-sidebar" aria-label="Latest posts">
          <h2 class="sidebar-title">Latest posts</h2>
          <?php foreach ($prefab_home_latest as $prefab_home_post) : ?>
            <?php setup_postdata($prefab_home_post); ?>
            <article class="latest-sidebar-item">
              <div class="latest-sidebar-thumb">
                <a href="<?php echo esc_url(get_permalink($prefab_home_post)); ?>" aria-label="<?php echo esc_attr(get_the_title($prefab_home_post)); ?>">
                  <?php echo get_the_post_thumbnail($prefab_home_post, 'thumbnail', ['alt' => get_the_title($prefab_home_post)]); ?>
                </a>
              </div>
              <div class="latest-sidebar-content">
                <h3 class="latest-sidebar-title">
                  <a href="<?php echo esc_url(get_permalink($prefab_home_post)); ?>"><?php echo esc_html(get_the_title($prefab_home_post)); ?></a>
                </h3>
                <span class="latest-sidebar-date"><?php echo esc_html(get_the_date('F j, Y', $prefab_home_post)); ?></span>
              </div>
            </article>
          <?php endforeach; ?>
          <?php wp_reset_postdata(); ?>
        </aside>
      </div>
    </div>
  </div>
</div>
<?php
get_footer();
