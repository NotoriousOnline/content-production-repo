<?php
/**
 * Plugin Name: Prefab Magazine Homepage Query
 * Description: Keeps paginated requests on the prefab.com blog homepage from 404ing while the custom front page runs its own post queries.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_filter('template_include', function ($template) {
    if (!is_front_page()) {
        return $template;
    }
    $theme_template = get_stylesheet_directory() . '/front-page.php';
    if (is_readable($theme_template)) {
        return $theme_template;
    }
    $fallback = __DIR__ . '/prefab-home/front-page.php';
    if (is_readable($fallback)) {
        return $fallback;
    }
    return $template;
}, 99);

add_action('pre_get_posts', function ($query) {
    if (is_admin() || !$query instanceof WP_Query || !$query->is_main_query()) {
        return;
    }
    if ($query->is_home() && $query->is_front_page()) {
        $query->set('posts_per_page', 9);
        $query->set('ignore_sticky_posts', true);
    }
});
