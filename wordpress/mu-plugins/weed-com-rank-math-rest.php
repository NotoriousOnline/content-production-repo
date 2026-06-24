<?php
/**
 * Plugin Name: Weed.com Content Studio — Rank Math REST
 * Description: Lets Content Studio read/write Rank Math focus keyword, meta description, and SEO title via REST.
 * Install: copy to wp-content/mu-plugins/weed-com-rank-math-rest.php on weed.com
 */

if (!defined('ABSPATH')) {
	exit;
}

add_action('rest_api_init', function () {
	$keys = array(
		'rank_math_title',
		'rank_math_description',
		'rank_math_focus_keyword',
	);

	foreach ($keys as $key) {
		register_post_meta(
			'post',
			$key,
			array(
				'show_in_rest'  => true,
				'single'        => true,
				'type'          => 'string',
				'auth_callback' => function () {
					return current_user_can('edit_posts');
				},
				'sanitize_callback' => 'sanitize_text_field',
			)
		);
	}

	register_rest_route(
		'weed-com-tools/v1',
		'/rank-math/(?P<id>\d+)',
		array(
			'methods'             => 'POST',
			'permission_callback' => function () {
				return current_user_can('edit_posts');
			},
			'callback'            => function (WP_REST_Request $request) {
				$post_id = (int) $request['id'];
				if ($post_id <= 0 || !get_post($post_id)) {
					return new WP_Error('invalid_post', 'Post not found', array('status' => 404));
				}

				$body    = $request->get_json_params();
				$updated = array();

				foreach ($keys as $key) {
					if (!isset($body[ $key ]) || !is_string($body[ $key ])) {
						continue;
					}
					$value = sanitize_text_field($body[ $key ]);
					update_post_meta($post_id, $key, $value);
					$updated[ $key ] = (string) get_post_meta($post_id, $key, true);
				}

				if (empty($updated)) {
					return new WP_Error('no_fields', 'No Rank Math fields provided', array('status' => 400));
				}

				return array(
					'success' => true,
					'post_id' => $post_id,
					'updated' => $updated,
				);
			},
		)
	);
});
